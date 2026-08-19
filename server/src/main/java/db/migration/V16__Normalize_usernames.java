package db.migration;

import com.chartsdk.auth.UsernameNormalizer;
import org.flywaydb.core.api.FlywayException;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 기존 아이디도 런타임과 동일한 NFKC 정규화 규칙으로 이행한다. */
public class V16__Normalize_usernames extends BaseJavaMigration {
    @Override
    public void migrate(Context context) throws Exception {
        List<UserName> users = new ArrayList<>();
        try (PreparedStatement statement = context.getConnection().prepareStatement(
                "SELECT id, username, username_normalized FROM mc_user ORDER BY id");
             ResultSet rows = statement.executeQuery()) {
            while (rows.next()) {
                String username = rows.getString("username");
                users.add(new UserName(rows.getLong("id"), username,
                        rows.getString("username_normalized"), UsernameNormalizer.normalize(username)));
            }
        }

        List<String> invalid = new ArrayList<>();
        Map<String, List<Long>> ownersByNormalized = new LinkedHashMap<>();
        for (UserName user : users) {
            if (!UsernameNormalizer.hasValidLength(user.normalized())) {
                invalid.add(user.id() + ":" + user.username());
            }
            ownersByNormalized.computeIfAbsent(user.normalized(), ignored -> new ArrayList<>()).add(user.id());
        }
        List<String> collisions = ownersByNormalized.entrySet().stream()
                .filter(entry -> entry.getValue().size() > 1)
                .map(entry -> entry.getKey() + "=" + entry.getValue())
                .toList();
        if (!invalid.isEmpty() || !collisions.isEmpty()) {
            throw new FlywayException("Username normalization preflight failed; invalid="
                    + invalid + ", collisions=" + collisions);
        }

        String sentinelPrefix = chooseSentinelPrefix(users);
        try (PreparedStatement update = context.getConnection().prepareStatement(
                "UPDATE mc_user SET username_normalized=? WHERE id=?")) {
            for (UserName user : users) {
                update.setString(1, sentinelPrefix + user.id());
                update.setLong(2, user.id());
                update.addBatch();
            }
            update.executeBatch();

            for (UserName user : users) {
                update.setString(1, user.normalized());
                update.setLong(2, user.id());
                update.addBatch();
            }
            update.executeBatch();
        }
    }

    private static String chooseSentinelPrefix(List<UserName> users) {
        Set<String> occupied = new HashSet<>();
        users.forEach(user -> {
            occupied.add(user.currentNormalized());
            occupied.add(user.normalized());
        });
        String prefix = "\uE000chartsdk-migration-";
        while (true) {
            boolean conflict = false;
            for (UserName user : users) {
                if (occupied.contains(prefix + user.id())) {
                    conflict = true;
                    break;
                }
            }
            if (!conflict) return prefix;
            prefix += "x";
        }
    }

    private record UserName(long id, String username, String currentNormalized, String normalized) {
    }
}
