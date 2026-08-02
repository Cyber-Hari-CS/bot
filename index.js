const fs = require('fs');
const path = require('path');

if (!fs.existsSync(path.join(__dirname, 'src', 'index.js'))) {
  console.error('❌ src/index.js was not found next to index.js.');
  console.error('Files in this folder:');
  for (const f of fs.readdirSync(__dirname)) console.error('  -', f);
  console.error('');
  console.error('The zip was not extracted correctly. Extract it so that src/, package.json, .env and index.js are ALL at the root (no subfolder).');
  process.exit(1);
}

require('./src/index.js');
