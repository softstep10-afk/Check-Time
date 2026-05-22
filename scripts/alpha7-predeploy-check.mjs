import { spawn } from "node:child_process";

const steps = [
  { label: "dangerous file scan", command: "npm", args: ["run", "check:dangerous"] },
  { label: "lint", command: "npm", args: ["run", "lint"] },
  { label: "typecheck", command: "npx", args: ["tsc", "--noEmit"] },
  { label: "tests", command: "npm", args: ["test"] },
  { label: "build", command: "npm", args: ["run", "build"] },
];

function runStep(step) {
  return new Promise((resolve, reject) => {
    console.log(`\n== Alpha-7 predeploy: ${step.label} ==`);
    const commandLine = [step.command, ...step.args].join(" ");
    const child = spawn(commandLine, {
      stdio: "inherit",
      shell: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${step.label} failed with exit code ${code}`));
    });
  });
}

console.log("Alpha-7 predeploy check");
console.log("Mode: local verification only. No deployment, SQL, migration, or production mutation.");

for (const step of steps) {
  await runStep(step);
}

console.log("\nAlpha-7 predeploy check passed.");
