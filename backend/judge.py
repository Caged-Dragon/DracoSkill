"""
DracoSkill — coding problems and the judge.

judge_submission() calls execution.run_code() once per test case and
compares real stdout to the expected value -- there's no shortcut path
that fabricates a verdict. A hidden test still runs for real; its input
and the submitter's output just aren't included in the response.
"""
from datetime import datetime, timezone

from db import get_db
from execution import run_code

PROBLEMS = {
    "sum-two": {
        "id": "sum-two",
        "title": "Sum of Two Numbers",
        "difficulty": "Easy",
        "description": "Read two space-separated integers from stdin and print their sum.",
        "starter": {
            "python": "a, b = map(int, input().split())\n# TODO: print the sum\n",
            "javascript": "const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(' ').map(Number);\n// TODO: print the sum\n",
            "java": "import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        long a = in.nextLong(), b = in.nextLong();\n        // TODO: print the sum\n    }\n}\n",
            "c": "#include <stdio.h>\n\nint main(void) {\n    long long a, b;\n    scanf(\"%lld %lld\", &a, &b);\n    /* TODO: print the sum */\n    return 0;\n}\n",
            "cpp": "#include <iostream>\n\nint main() {\n    long long a, b;\n    std::cin >> a >> b;\n    // TODO: print the sum\n    return 0;\n}\n",
        },
        "tests": [
            {"input": "2 3", "expected": "5"},
            {"input": "10 20", "expected": "30"},
            {"input": "-5 5", "expected": "0", "hidden": True},
        ],
    },
    "reverse-string": {
        "id": "reverse-string",
        "title": "Reverse a String",
        "difficulty": "Easy",
        "description": "Read a line from stdin and print it reversed.",
        "starter": {
            "python": "s = input()\n# TODO: print the reversed string\n",
            "javascript": "const s = require('fs').readFileSync(0, 'utf8').trim();\n// TODO: print the reversed string\n",
            "java": "import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        String s = in.nextLine();\n        // TODO: print the reversed string\n    }\n}\n",
            "c": "#include <stdio.h>\n#include <string.h>\n\nint main(void) {\n    char s[1024];\n    fgets(s, sizeof s, stdin);\n    s[strcspn(s, \"\\n\")] = 0;\n    /* TODO: print the reversed string */\n    return 0;\n}\n",
            "cpp": "#include <iostream>\n#include <string>\n\nint main() {\n    std::string s;\n    std::getline(std::cin, s);\n    // TODO: print the reversed string\n    return 0;\n}\n",
        },
        "tests": [
            {"input": "hello", "expected": "olleh"},
            {"input": "DracoSkill", "expected": "llikSocarD"},
            {"input": "a", "expected": "a", "hidden": True},
        ],
    },
    "is-prime": {
        "id": "is-prime",
        "title": "Is It Prime?",
        "difficulty": "Medium",
        "description": "Read one integer from stdin and print true if it's prime, false otherwise. 0 and 1 are not prime.",
        "starter": {
            "python": "n = int(input())\n# TODO: print true or false\n",
            "javascript": "const n = Number(require('fs').readFileSync(0, 'utf8').trim());\n// TODO: print true or false\n",
            "java": "import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        long n = new Scanner(System.in).nextLong();\n        // TODO: print true or false\n    }\n}\n",
            "c": "#include <stdio.h>\n\nint main(void) {\n    long long n;\n    scanf(\"%lld\", &n);\n    /* TODO: print true or false */\n    return 0;\n}\n",
            "cpp": "#include <iostream>\n\nint main() {\n    long long n;\n    std::cin >> n;\n    // TODO: print true or false\n    return 0;\n}\n",
        },
        "tests": [
            {"input": "7", "expected": "true"},
            {"input": "8", "expected": "false"},
            {"input": "1", "expected": "false"},
            {"input": "97", "expected": "true", "hidden": True},
        ],
    },
}


def judge_submission(problem_id, language, code):
    problem = PROBLEMS.get(problem_id)
    if problem is None:
        return {"error": f"Unknown problem: {problem_id}"}, 404

    results = []
    all_passed = True
    saw_timeout = False
    saw_runtime_error = False
    saw_compile_error = False

    for i, t in enumerate(problem["tests"]):
        res, status = run_code(language, code, t["input"])
        if status not in (200,):
            saw_runtime_error = True
            all_passed = False
            results.append({"index": i, "hidden": t.get("hidden", False), "pass": False, "stderr": res.get("stderr") or res.get("error", "")})
            continue

        if res.get("compileError"):
            saw_compile_error = True
            all_passed = False
            results.append({"index": i, "hidden": t.get("hidden", False), "pass": False, "stderr": res.get("stderr", "")})
            continue

        timed_out = bool(res.get("timedOut"))
        bad_exit = (res.get("exitCode") not in (0, None))  # a C segfault prints nothing to stderr
        has_stderr = bool(res.get("stderr")) or bad_exit
        actual = (res.get("stdout") or "").strip()
        expected = t["expected"].strip()
        passed = (not timed_out) and (not has_stderr) and (actual == expected)

        if timed_out:
            saw_timeout = True
        elif has_stderr:
            saw_runtime_error = True
        if not passed:
            all_passed = False

        entry = {"index": i, "hidden": t.get("hidden", False), "pass": passed}
        if not t.get("hidden", False):
            entry["input"] = t["input"]
            entry["expected"] = expected
            entry["actual"] = actual
        if has_stderr:
            entry["stderr"] = res.get("stderr") or f"Process exited with code {res.get('exitCode')}"
        results.append(entry)

    if all_passed:
        verdict = "Accepted"
    elif saw_compile_error:
        verdict = "Compilation Error"
    elif saw_timeout:
        verdict = "Time Limit Exceeded"
    elif saw_runtime_error:
        verdict = "Runtime Error"
    else:
        verdict = "Wrong Answer"

    return {"verdict": verdict, "results": results}, 200


def save_submission(user_id, problem_id, language, code, verdict):
    conn = get_db()
    conn.execute(
        "INSERT INTO submissions (user_id, problem_id, language, code, verdict, submitted_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, problem_id, language, code, verdict, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()
