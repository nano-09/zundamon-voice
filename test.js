const { spawn } = require('child_process');
const p = spawn('node', ['-e', 'process.stdin.setEncoding("utf8"); process.stdin.on("data", d => console.log(d)); setInterval(() => console.log("child running"), 1000);']);
p.stdout.on('data', d => console.log(d.toString()));
setTimeout(() => {
  console.log('parent exiting');
  process.exit();
}, 2000);
