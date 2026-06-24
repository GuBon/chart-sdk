$env:NEXT_PUBLIC_API_BASE = 'http://127.0.0.1:8080'
$env:NEXT_PUBLIC_ENABLE_MSW = 'false'
Set-Location 'C:\Users\admin\Desktop\chartsdk\admin'
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\admin\Desktop\chartsdk\node_modules\next\dist\bin\next' dev -p 3100
