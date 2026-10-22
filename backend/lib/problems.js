// Generated from the Python judge's problem set. Plain JS module on purpose (no JSON import attributes).
export default {
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
   "cpp": "#include <iostream>\n\nint main() {\n    long long a, b;\n    std::cin >> a >> b;\n    // TODO: print the sum\n    return 0;\n}\n"
  },
  "tests": [
   {
    "input": "2 3",
    "expected": "5"
   },
   {
    "input": "10 20",
    "expected": "30"
   },
   {
    "input": "-5 5",
    "expected": "0",
    "hidden": true
   }
  ]
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
   "cpp": "#include <iostream>\n#include <string>\n\nint main() {\n    std::string s;\n    std::getline(std::cin, s);\n    // TODO: print the reversed string\n    return 0;\n}\n"
  },
  "tests": [
   {
    "input": "hello",
    "expected": "olleh"
   },
   {
    "input": "DracoSkill",
    "expected": "llikSocarD"
   },
   {
    "input": "a",
    "expected": "a",
    "hidden": true
   }
  ]
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
   "cpp": "#include <iostream>\n\nint main() {\n    long long n;\n    std::cin >> n;\n    // TODO: print true or false\n    return 0;\n}\n"
  },
  "tests": [
   {
    "input": "7",
    "expected": "true"
   },
   {
    "input": "8",
    "expected": "false"
   },
   {
    "input": "1",
    "expected": "false"
   },
   {
    "input": "97",
    "expected": "true",
    "hidden": true
   }
  ]
 }
};
