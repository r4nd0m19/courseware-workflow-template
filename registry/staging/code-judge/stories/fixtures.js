// Story fixtures for the code-judge component. The runtimeBaseUrl is relative
// to registry/staging/code-judge/stories/index.html, so the same bundle works
// when the package is opened directly from disk.
;(function () {
  window.CODE_JUDGE_FIXTURES = {
    sum: {
      ariaLabel: 'A+B 代码练习',
      runtimeBaseUrl: '../../../../judge-runtime/',
      statement:
        '输入两个整数 a 和 b，输出它们的和。\n\n提示：用 cin 读入，用 cout 输出，最后换行。',
      starterCode:
        '#include <iostream>\nusing namespace std;\n\nint main() {\n  int a, b;\n  // 在这里读入 a 和 b\n\n  // 输出 a + b\n\n  return 0;\n}\n',
      tests: [
        { id: 't1', label: '样例 1', input: '2 3\n', expected: '5\n' },
        { id: 't2', label: '样例 2', input: '10 0\n', expected: '10\n' },
        { id: 't3', label: '负数', input: '-4 7\n', expected: '3\n' },
      ],
      timeLimitMs: 2000,
    },
    reverse: {
      ariaLabel: '倒序输出练习',
      runtimeBaseUrl: '../../../../judge-runtime/',
      statement: '读入 3 个整数，按相反顺序输出，每个数之间用一个空格隔开。',
      starterCode:
        '#include <iostream>\nusing namespace std;\n\nint main() {\n  int a, b, c;\n  cin >> a >> b >> c;\n  cout << c << " " << b << " " << a << "\\n";\n  return 0;\n}\n',
      tests: [
        { id: 't1', label: '样例', input: '1 2 3\n', expected: '3 2 1\n' },
        { id: 't2', label: '含负数', input: '-1 0 9\n', expected: '9 0 -1\n' },
      ],
      timeLimitMs: 2000,
    },
  }
})()
