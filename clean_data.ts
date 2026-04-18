import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './src/db/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. Truncate DB
console.log('Truncating database...');
try {
  db.prepare('DELETE FROM tasks').run();
  db.prepare('DELETE FROM assets').run();
  console.log('Database tables cleared.');
} catch (e) {
  console.error('DB clear error:', e);
}

// 2. Clear directories
const dirsToClean = [
  path.join(__dirname, 'task'),
  path.join(__dirname, 'task_video'),
  path.join(__dirname, 'download'),
  path.join(__dirname, 'uploads'),
  path.join(__dirname, 'thumbnails')
];

const emptyDir = (dir: string) => {
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
         emptyDir(fullPath);
         try { fs.rmdirSync(fullPath); } catch(e) {}
      } else {
         try { fs.unlinkSync(fullPath); } catch(e) {}
      }
    }
  }
};

console.log('Cleaning directories...');
dirsToClean.forEach(dir => {
  console.log(`Emptying: ${dir}`);
  emptyDir(dir);
});

console.log('All legacy data cleared. Ready for fresh start.');
