"""Run repository checks with Python and Node; no npm install or server needed."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent


def main():
    commands = [
        [sys.executable, "scripts/package_merge.py", "--check"],
        [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", "*_test.py"],
        ["node", "--test", *[str(p.relative_to(ROOT)) for p in sorted((ROOT / "tests").glob("*.test.js"))]],
    ]
    # Editor tooling is optional and is never installed by this command.
    checker = ROOT / "node_modules" / "typescript" / "bin" / "tsc"
    if checker.is_file():
        commands.append(["node", str(checker), "-p", "jsconfig.json"])
    for command in commands:
        print("Running: " + " ".join(command), flush=True)
        subprocess.run(command, cwd=ROOT, check=True)
    if not checker.is_file():
        print("Optional TypeScript checker not found; skipped JSDoc type checking.")
    print("All available checks passed.")


if __name__ == "__main__":
    try:
        main()
    except (subprocess.CalledProcessError, OSError) as error:
        sys.exit(str(error))
