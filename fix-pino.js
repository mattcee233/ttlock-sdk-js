const fs = require('fs');

function fixFile(filePath, useThis) {
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;
  const prefix = useThis ? 'this\\.' : '';
  const logVar = useThis ? 'this.log' : 'log';

  // Fix: log.xxx("text %o", expr) — convert to template literal
  const re1 = new RegExp(prefix + 'log\\.(debug|info|warn|error)\\("([^"]+?)\\s*%o",\\s*([^;)\\n]+?)\\s*\\)', 'g');
  content = content.replace(re1, (_, level, label, expr) => {
    const cleanLabel = label.replace(/:?\s*$/, '').trim();
    return logVar + '.' + level + '(`' + cleanLabel + ': ${' + expr + '}`)';
  });

  // Fix: log.xxx("text:", value) — no %o but trailing colon
  const re2 = new RegExp(prefix + 'log\\.(debug|info|warn|error)\\("([^"]+):",\\s*([^;)\\n]+?)\\s*\\)', 'g');
  content = content.replace(re2, (_, level, label, expr) => {
    return logVar + '.' + level + '(`' + label + ': ${' + expr + '}`)';
  });

  if (content !== original) {
    fs.writeFileSync(filePath, content);
    console.log('Fixed: ' + filePath);
  } else {
    console.log('No changes: ' + filePath);
  }
}

fixFile('src/device/TTLock.ts', true);
fixFile('src/device/TTLockApi.ts', false);
fixFile('src/api/Command.ts', false);
fixFile('src/api/Commands/SetAdminKeyboardPwdCommand.ts', false);
fixFile('src/scanner/noble/NobleDevice.ts', false);
fixFile('src/scanner/noble/NobleDescriptor.ts', false);
fixFile('src/scanner/noble/NobleWebsocketBinding.ts', false);
