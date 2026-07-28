const runtime = require('./runtime.cjs');

module.exports = async () => {
  runtime.cleanup();
};
