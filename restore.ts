import { execSync } from 'child_process';
try {
  console.log("GIT STATUS:");
  console.log(execSync("git status", { encoding: "utf8" }));
  
  console.log("GIT DIFF FOR APP.tsx:");
  const diff = execSync("git diff src/App.tsx", { encoding: "utf8" });
  console.log(diff.slice(0, 1000));
} catch (e: any) {
  console.error("Error running git:", e.message);
}
