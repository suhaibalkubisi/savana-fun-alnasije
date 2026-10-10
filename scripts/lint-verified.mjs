import {spawn} from 'node:child_process';
// Use the same ESLint rules on Windows and Linux without requiring a Bash shell.
const child=spawn(process.execPath,['node_modules/eslint/bin/eslint.js','.','--ignore-pattern','dist','--ignore-pattern','.next'],{stdio:'inherit',windowsHide:true});
const timer=setTimeout(()=>{child.kill('SIGTERM');process.exitCode=124;},180000);
child.once('error',error=>{clearTimeout(timer);console.error(error.message);process.exitCode=1;});
child.once('close',code=>{clearTimeout(timer);if(process.exitCode!==124)process.exitCode=code??1;});
