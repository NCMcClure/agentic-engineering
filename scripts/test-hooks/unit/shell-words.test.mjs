// shell-words.mjs: recorded readings of command lines it must reproduce field for
// field, then the cases for comments, background jobs, segments and the working
// folder. Strings in, values out: nothing here spawns a shell or touches a file.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LEADERS, SHELLS, assignments, baseName, commandWords, expand, gitCommand, psAssignment, shellWords,
  splitCommand, splitLead, textOf, trackCwd, unwrap,
} from "../../shared/shell-words.mjs";

// The wrapper the recorded readings were taken with: `aw lock run <resource> ... -- <command>` and
// `aw lease <resource> ... -- <command>` run a command, `--json` may stand anywhere, any other use runs none.
const plain = (args) => args.filter((w) => w !== "--json");
const WRAPPER = {
  names: ["aw", "aw.cmd", "aw.py"],
  wraps: (args) => plain(args).slice(0, 2).join(" ") === "lock run" || plain(args)[0] === "lease",
};
/** The resources the peeled `lock run` wrappers name, sorted. */
const held = (wrappers) => [...new Set(wrappers.map(plain)
  .filter((sub) => sub.slice(0, 2).join(" ") === "lock run")
  .map((sub) => sub.slice(2).find((w) => !w.startsWith("-")))
  .filter(Boolean))].sort();

// One entry per command line:
//   words     shellWords(command)
//   expanded  expand(words)
//   segs      per expanded segment: splitLead's two parts, psAssignment of the command's words as
//             [name, value], unwrap of them with WRAPPER (the resources held, the wrapped segments),
//             textOf and the baseName of the first word
//   assigned  assignments(expanded) as [name, value] pairs, in the order first set
const GOLDEN = [
  {
    command: "a b && c 'd e' | f; g || h\ni",
    words: [["a","b"],["c","d e"],["f"],["g"],["h"],["i"]],
    expanded: [["a","b"],["c","d e"],["f"],["g"],["h"],["i"]],
    segs: [
      {"lead":[],"words":["a","b"],"ps":null,"held":[],"inner":[["a","b"]],"text":"a b","base":"a"},
      {"lead":[],"words":["c","d e"],"ps":null,"held":[],"inner":[["c","d e"]],"text":"c d e","base":"c"},
      {"lead":[],"words":["f"],"ps":null,"held":[],"inner":[["f"]],"text":"f","base":"f"},
      {"lead":[],"words":["g"],"ps":null,"held":[],"inner":[["g"]],"text":"g","base":"g"},
      {"lead":[],"words":["h"],"ps":null,"held":[],"inner":[["h"]],"text":"h","base":"h"},
      {"lead":[],"words":["i"],"ps":null,"held":[],"inner":[["i"]],"text":"i","base":"i"},
    ],
    assigned: [],
  },
  {
    command: "git commit -m \"a; b | c && d\"",
    words: [["git","commit","-m","a; b | c && d"]],
    expanded: [["git","commit","-m","a; b | c && d"]],
    segs: [
      {"lead":[],"words":["git","commit","-m","a; b | c && d"],"ps":null,"held":[],"inner":[["git","commit","-m","a; b | c && d"]],"text":"git commit -m a; b | c && d","base":"git"},
    ],
    assigned: [],
  },
  {
    command: "X=\"a b\" run --flag=1 2>&1",
    words: [["X=a b","run","--flag=1","2>&1"]],
    expanded: [["X=a b","run","--flag=1","2>&1"]],
    segs: [
      {"lead":["X=a b"],"words":["run","--flag=1","2>&1"],"ps":null,"held":[],"inner":[["run","--flag=1","2>&1"]],"text":"run --flag=1 2>&1","base":"run"},
    ],
    assigned: [["X","a b"]],
  },
  {
    command: "a \\\n b",
    words: [["a","b"]],
    expanded: [["a","b"]],
    segs: [
      {"lead":[],"words":["a","b"],"ps":null,"held":[],"inner":[["a","b"]],"text":"a b","base":"a"},
    ],
    assigned: [],
  },
  {
    command: "a `\r\n b",
    words: [["a","b"]],
    expanded: [["a","b"]],
    segs: [
      {"lead":[],"words":["a","b"],"ps":null,"held":[],"inner":[["a","b"]],"text":"a b","base":"a"},
    ],
    assigned: [],
  },
  {
    command: "a \\\r\nb; c \\\rXd",
    words: [["a","b"],["c","d"]],
    expanded: [["a","b"],["c","d"]],
    segs: [
      {"lead":[],"words":["a","b"],"ps":null,"held":[],"inner":[["a","b"]],"text":"a b","base":"a"},
      {"lead":[],"words":["c","d"],"ps":null,"held":[],"inner":[["c","d"]],"text":"c d","base":"c"},
    ],
    assigned: [],
  },
  {
    command: "a\tb\r\nc",
    words: [["a","b"],["c"]],
    expanded: [["a","b"],["c"]],
    segs: [
      {"lead":[],"words":["a","b"],"ps":null,"held":[],"inner":[["a","b"]],"text":"a b","base":"a"},
      {"lead":[],"words":["c"],"ps":null,"held":[],"inner":[["c"]],"text":"c","base":"c"},
    ],
    assigned: [],
  },
  {
    command: "",
    words: [],
    expanded: [],
    segs: [],
    assigned: [],
  },
  {
    command: "   \n\n ; ",
    words: [],
    expanded: [],
    segs: [],
    assigned: [],
  },
  {
    command: "echo a;;b ||  | c",
    words: [["echo","a"],["b"],["c"]],
    expanded: [["echo","a"],["b"],["c"]],
    segs: [
      {"lead":[],"words":["echo","a"],"ps":null,"held":[],"inner":[["echo","a"]],"text":"echo a","base":"echo"},
      {"lead":[],"words":["b"],"ps":null,"held":[],"inner":[["b"]],"text":"b","base":"b"},
      {"lead":[],"words":["c"],"ps":null,"held":[],"inner":[["c"]],"text":"c","base":"c"},
    ],
    assigned: [],
  },
  {
    command: "git commit -m 'it'\"'\"'s; fine' && ls",
    words: [["git","commit","-m","it's; fine"],["ls"]],
    expanded: [["git","commit","-m","it's; fine"],["ls"]],
    segs: [
      {"lead":[],"words":["git","commit","-m","it's; fine"],"ps":null,"held":[],"inner":[["git","commit","-m","it's; fine"]],"text":"git commit -m it's; fine","base":"git"},
      {"lead":[],"words":["ls"],"ps":null,"held":[],"inner":[["ls"]],"text":"ls","base":"ls"},
    ],
    assigned: [],
  },
  {
    command: "tool --opt=\"a b\" 'c'd\"e\" \"\" '' x",
    words: [["tool","--opt=a b","cde","","","x"]],
    expanded: [["tool","--opt=a b","cde","","","x"]],
    segs: [
      {"lead":[],"words":["tool","--opt=a b","cde","x"],"ps":null,"held":[],"inner":[["tool","--opt=a b","cde","x"]],"text":"tool --opt=a b cde x","base":"tool"},
    ],
    assigned: [],
  },
  {
    command: "echo 'abc; def",
    words: [["echo","abc; def"]],
    expanded: [["echo","abc; def"]],
    segs: [
      {"lead":[],"words":["echo","abc; def"],"ps":null,"held":[],"inner":[["echo","abc; def"]],"text":"echo abc; def","base":"echo"},
    ],
    assigned: [],
  },
  {
    command: "echo \"abc; def",
    words: [["echo","abc; def"]],
    expanded: [["echo","abc; def"]],
    segs: [
      {"lead":[],"words":["echo","abc; def"],"ps":null,"held":[],"inner":[["echo","abc; def"]],"text":"echo abc; def","base":"echo"},
    ],
    assigned: [],
  },
  {
    command: "echo \"a \\\" b; c\" d",
    words: [["echo","a \\\" b; c","d"]],
    expanded: [["echo","a \\\" b; c","d"]],
    segs: [
      {"lead":[],"words":["echo","a \\\" b; c","d"],"ps":null,"held":[],"inner":[["echo","a \\\" b; c","d"]],"text":"echo a \\\" b; c d","base":"echo"},
    ],
    assigned: [],
  },
  {
    command: "echo \"a `\" b; c\" d",
    words: [["echo","a `\" b; c","d"]],
    expanded: [["echo","a `\" b; c","d"]],
    segs: [
      {"lead":[],"words":["echo","a `\" b; c","d"],"ps":null,"held":[],"inner":[["echo","a `\" b; c","d"]],"text":"echo a `\" b; c d","base":"echo"},
    ],
    assigned: [],
  },
  {
    command: "echo a\\ b c:\\dir\\file.txt",
    words: [["echo","a\\","b","c:\\dir\\file.txt"]],
    expanded: [["echo","a\\","b","c:\\dir\\file.txt"]],
    segs: [
      {"lead":[],"words":["echo","a\\","b","c:\\dir\\file.txt"],"ps":null,"held":[],"inner":[["echo","a\\","b","c:\\dir\\file.txt"]],"text":"echo a\\ b c:\\dir\\file.txt","base":"echo"},
    ],
    assigned: [],
  },
  {
    command: "find . -name '*.py' -exec rm {} \\;",
    words: [["find",".","-name","*.py","-exec","rm","{}","\\"]],
    expanded: [["find",".","-name","*.py","-exec","rm","{}","\\"]],
    segs: [
      {"lead":[],"words":["find",".","-name","*.py","-exec","rm","{}","\\"],"ps":null,"held":[],"inner":[["find",".","-name","*.py","-exec","rm","{}","\\"]],"text":"find . -name *.py -exec rm {} \\","base":"find"},
    ],
    assigned: [],
  },
  {
    command: "git add $(git diff --name-only | head -3) x",
    words: [["git","add","$(git diff --name-only | head -3)","x"]],
    expanded: [["git","add","$(git diff --name-only | head -3)","x"]],
    segs: [
      {"lead":[],"words":["git","add","$(git diff --name-only | head -3)","x"],"ps":null,"held":[],"inner":[["git","add","$(git diff --name-only | head -3)","x"]],"text":"git add $(git diff --name-only | head -3) x","base":"git"},
    ],
    assigned: [],
  },
  {
    command: "echo \"$(printf \"a;b\")\" c",
    words: [["echo","$(printf \"a;b\")","c"]],
    expanded: [["echo","$(printf \"a;b\")","c"]],
    segs: [
      {"lead":[],"words":["echo","$(printf \"a;b\")","c"],"ps":null,"held":[],"inner":[["echo","$(printf \"a;b\")","c"]],"text":"echo $(printf \"a;b\") c","base":"echo"},
    ],
    assigned: [],
  },
  {
    command: "x=$(echo \")\" '(' ) y; echo $((1+2)) $(echo $(date; ls))",
    words: [["x=$(echo \")\" '(' )","y"],["echo","$((1+2))","$(echo $(date; ls))"]],
    expanded: [["x=$(echo \")\" '(' )","y"],["echo","$((1+2))","$(echo $(date; ls))"]],
    segs: [
      {"lead":["x=$(echo \")\" '(' )"],"words":["y"],"ps":null,"held":[],"inner":[["y"]],"text":"y","base":"y"},
      {"lead":[],"words":["echo","$((1+2))","$(echo $(date; ls))"],"ps":null,"held":[],"inner":[["echo","$((1+2))","$(echo $(date; ls))"]],"text":"echo $((1+2)) $(echo $(date; ls))","base":"echo"},
    ],
    assigned: [["x","$(echo \")\" '(' )"]],
  },
  {
    command: "echo \"unterminated $(foo; bar",
    words: [["echo","unterminated $(foo; bar"]],
    expanded: [["echo","unterminated $(foo; bar"]],
    segs: [
      {"lead":[],"words":["echo","unterminated $(foo; bar"],"ps":null,"held":[],"inner":[["echo","unterminated $(foo; bar"]],"text":"echo unterminated $(foo; bar","base":"echo"},
    ],
    assigned: [],
  },
  {
    command: "$(cmd) arg; \"$x\" y",
    words: [["$(cmd)","arg"],["$x","y"]],
    expanded: [["$(cmd)","arg"],["$x","y"]],
    segs: [
      {"lead":[],"words":["$(cmd)","arg"],"ps":null,"held":[],"inner":[["$(cmd)","arg"]],"text":"$(cmd) arg","base":"$(cmd)"},
      {"lead":[],"words":["$x","y"],"ps":null,"held":[],"inner":[["$x","y"]],"text":"$x y","base":"$x"},
    ],
    assigned: [],
  },
  {
    command: "cat <<EOF > out.txt\nrm -rf /; git add -A\nEOF\necho done",
    words: [["cat",">","out.txt"],["echo","done"]],
    expanded: [["cat",">","out.txt"],["echo","done"]],
    segs: [
      {"lead":[],"words":["cat",">","out.txt"],"ps":null,"held":[],"inner":[["cat",">","out.txt"]],"text":"cat > out.txt","base":"cat"},
      {"lead":[],"words":["echo","done"],"ps":null,"held":[],"inner":[["echo","done"]],"text":"echo done","base":"echo"},
    ],
    assigned: [],
  },
  {
    command: "cat <<-'END'\n\tgit push --force\n\tEND\nls",
    words: [["cat"],["ls"]],
    expanded: [["cat"],["ls"]],
    segs: [
      {"lead":[],"words":["cat"],"ps":null,"held":[],"inner":[["cat"]],"text":"cat","base":"cat"},
      {"lead":[],"words":["ls"],"ps":null,"held":[],"inner":[["ls"]],"text":"ls","base":"ls"},
    ],
    assigned: [],
  },
  {
    command: "cat <<\"EOF\" | grep x\nfoo | bar\nEOF\necho after",
    words: [["cat"],["grep","x"],["echo","after"]],
    expanded: [["cat"],["grep","x"],["echo","after"]],
    segs: [
      {"lead":[],"words":["cat"],"ps":null,"held":[],"inner":[["cat"]],"text":"cat","base":"cat"},
      {"lead":[],"words":["grep","x"],"ps":null,"held":[],"inner":[["grep","x"]],"text":"grep x","base":"grep"},
      {"lead":[],"words":["echo","after"],"ps":null,"held":[],"inner":[["echo","after"]],"text":"echo after","base":"echo"},
    ],
    assigned: [],
  },
  {
    command: "cat <<EOF\nbody; rm x\n",
    words: [["cat"]],
    expanded: [["cat"]],
    segs: [
      {"lead":[],"words":["cat"],"ps":null,"held":[],"inner":[["cat"]],"text":"cat","base":"cat"},
    ],
    assigned: [],
  },
  {
    command: "cat <<EOF\r\nbody; x\r\nEOF\r\necho ok",
    words: [["cat"],["echo","ok"]],
    expanded: [["cat"],["echo","ok"]],
    segs: [
      {"lead":[],"words":["cat"],"ps":null,"held":[],"inner":[["cat"]],"text":"cat","base":"cat"},
      {"lead":[],"words":["echo","ok"],"ps":null,"held":[],"inner":[["echo","ok"]],"text":"echo ok","base":"echo"},
    ],
    assigned: [],
  },
  {
    command: "a<<EOF\nb; c\nEOF",
    words: [["a"]],
    expanded: [["a"]],
    segs: [
      {"lead":[],"words":["a"],"ps":null,"held":[],"inner":[["a"]],"text":"a","base":"a"},
    ],
    assigned: [],
  },
  {
    command: "cat << EOF\nx; y\n  EOF  \nz",
    words: [["cat"],["z"]],
    expanded: [["cat"],["z"]],
    segs: [
      {"lead":[],"words":["cat"],"ps":null,"held":[],"inner":[["cat"]],"text":"cat","base":"cat"},
      {"lead":[],"words":["z"],"ps":null,"held":[],"inner":[["z"]],"text":"z","base":"z"},
    ],
    assigned: [],
  },
  {
    command: "echo \"$(cat <<EOF\nx; y\nEOF\n)\" z",
    words: [["echo","$(cat \n)","z"]],
    expanded: [["echo","$(cat \n)","z"]],
    segs: [
      {"lead":[],"words":["echo","$(cat \n)","z"],"ps":null,"held":[],"inner":[["echo","$(cat \n)","z"]],"text":"echo $(cat \n) z","base":"echo"},
    ],
    assigned: [],
  },
  {
    command: "cat <<A <<B\none; two\nA\nthree | four\nB\nfive",
    words: [["cat"],["five"]],
    expanded: [["cat"],["five"]],
    segs: [
      {"lead":[],"words":["cat"],"ps":null,"held":[],"inner":[["cat"]],"text":"cat","base":"cat"},
      {"lead":[],"words":["five"],"ps":null,"held":[],"inner":[["five"]],"text":"five","base":"five"},
    ],
    assigned: [],
  },
  {
    command: "cat <<'E-O-F'\nbody; here\nE-O-F",
    words: [["cat","<<E-O-F"],["body"],["here"],["E-O-F"]],
    expanded: [["cat","<<E-O-F"],["body"],["here"],["E-O-F"]],
    segs: [
      {"lead":[],"words":["cat","<<E-O-F"],"ps":null,"held":[],"inner":[["cat","<<E-O-F"]],"text":"cat <<E-O-F","base":"cat"},
      {"lead":[],"words":["body"],"ps":null,"held":[],"inner":[["body"]],"text":"body","base":"body"},
      {"lead":[],"words":["here"],"ps":null,"held":[],"inner":[["here"]],"text":"here","base":"here"},
      {"lead":[],"words":["E-O-F"],"ps":null,"held":[],"inner":[["E-O-F"]],"text":"E-O-F","base":"e-o-f"},
    ],
    assigned: [],
  },
  {
    command: "python - <<PY\nimport os; os.system('git push --force')\nPY\ngit status",
    words: [["python","-"],["git","status"]],
    expanded: [["python","-"],["git","status"]],
    segs: [
      {"lead":[],"words":["python","-"],"ps":null,"held":[],"inner":[["python","-"]],"text":"python -","base":"python"},
      {"lead":[],"words":["git","status"],"ps":null,"held":[],"inner":[["git","status"]],"text":"git status","base":"git"},
    ],
    assigned: [],
  },
  {
    command: "x -m @'\none; two\n'@ tail",
    words: [["x","-m","one; two","tail"]],
    expanded: [["x","-m","one; two","tail"]],
    segs: [
      {"lead":[],"words":["x","-m","one; two","tail"],"ps":null,"held":[],"inner":[["x","-m","one; two","tail"]],"text":"x -m one; two tail","base":"x"},
    ],
    assigned: [],
  },
  {
    command: "x @\"\nbody | more\n\"@",
    words: [["x","body | more"]],
    expanded: [["x","body | more"]],
    segs: [
      {"lead":[],"words":["x","body | more"],"ps":null,"held":[],"inner":[["x","body | more"]],"text":"x body | more","base":"x"},
    ],
    assigned: [],
  },
  {
    command: "x @'\nbody; more",
    words: [["x","body; more"]],
    expanded: [["x","body; more"]],
    segs: [
      {"lead":[],"words":["x","body; more"],"ps":null,"held":[],"inner":[["x","body; more"]],"text":"x body; more","base":"x"},
    ],
    assigned: [],
  },
  {
    command: "x @'\r\nline one; two\r\n'@; y",
    words: [["x","line one; two\r"],["y"]],
    expanded: [["x","line one; two\r"],["y"]],
    segs: [
      {"lead":[],"words":["x","line one; two\r"],"ps":null,"held":[],"inner":[["x","line one; two\r"]],"text":"x line one; two\r","base":"x"},
      {"lead":[],"words":["y"],"ps":null,"held":[],"inner":[["y"]],"text":"y","base":"y"},
    ],
    assigned: [],
  },
  {
    command: "echo @'not here'@ b",
    words: [["echo","@not here@","b"]],
    expanded: [["echo","@not here@","b"]],
    segs: [
      {"lead":[],"words":["echo","@not here@","b"],"ps":null,"held":[],"inner":[["echo","@not here@","b"]],"text":"echo @not here@ b","base":"echo"},
    ],
    assigned: [],
  },
  {
    command: "$env:AW_RUN = \"verify: because of this\"; AW_AGENT=a1 X=2 tool; export Y=3; $env:Z=\"4\"",
    words: [["$env:AW_RUN","=","verify: because of this"],["AW_AGENT=a1","X=2","tool"],["export","Y=3"],["$env:Z=4"]],
    expanded: [["$env:AW_RUN","=","verify: because of this"],["AW_AGENT=a1","X=2","tool"],["export","Y=3"],["$env:Z=4"]],
    segs: [
      {"lead":[],"words":["$env:AW_RUN","=","verify: because of this"],"ps":["AW_RUN","verify: because of this"],"held":[],"inner":[["$env:AW_RUN","=","verify: because of this"]],"text":"$env:AW_RUN = verify: because of this","base":"$env:aw_run"},
      {"lead":["AW_AGENT=a1","X=2"],"words":["tool"],"ps":null,"held":[],"inner":[["tool"]],"text":"tool","base":"tool"},
      {"lead":["export","Y=3"],"words":[],"ps":null,"held":[],"inner":[],"text":"","base":""},
      {"lead":[],"words":["$env:Z=4"],"ps":["Z","4"],"held":[],"inner":[["$env:Z=4"]],"text":"$env:Z=4","base":"$env:z=4"},
    ],
    assigned: [["AW_RUN","verify: because of this"],["AW_AGENT","a1"],["X","2"],["Y","3"],["Z","4"]],
  },
  {
    command: "$env:SAFE_MARKER = \"\"; cmd",
    words: [["$env:SAFE_MARKER","=",""],["cmd"]],
    expanded: [["$env:SAFE_MARKER","=",""],["cmd"]],
    segs: [
      {"lead":[],"words":["$env:SAFE_MARKER","="],"ps":["SAFE_MARKER",""],"held":[],"inner":[["$env:SAFE_MARKER","="]],"text":"$env:SAFE_MARKER =","base":"$env:safe_marker"},
      {"lead":[],"words":["cmd"],"ps":null,"held":[],"inner":[["cmd"]],"text":"cmd","base":"cmd"},
    ],
    assigned: [["SAFE_MARKER",""]],
  },
  {
    command: "$env:X = $null; cmd; $env:Y =; $env:W=a b c",
    words: [["$env:X","=","$null"],["cmd"],["$env:Y","="],["$env:W=a","b","c"]],
    expanded: [["$env:X","=","$null"],["cmd"],["$env:Y","="],["$env:W=a","b","c"]],
    segs: [
      {"lead":[],"words":["$env:X","=","$null"],"ps":["X","$null"],"held":[],"inner":[["$env:X","=","$null"]],"text":"$env:X = $null","base":"$env:x"},
      {"lead":[],"words":["cmd"],"ps":null,"held":[],"inner":[["cmd"]],"text":"cmd","base":"cmd"},
      {"lead":[],"words":["$env:Y","="],"ps":["Y",""],"held":[],"inner":[["$env:Y","="]],"text":"$env:Y =","base":"$env:y"},
      {"lead":[],"words":["$env:W=a","b","c"],"ps":["W","a b c"],"held":[],"inner":[["$env:W=a","b","c"]],"text":"$env:W=a b c","base":"$env:w=a"},
    ],
    assigned: [["X","$null"],["W","a"]],
  },
  {
    command: "$Env:Path=\"C:\\bin;$env:Path\" tool run",
    words: [["$Env:Path=C:\\bin;$env:Path","tool","run"]],
    expanded: [["$Env:Path=C:\\bin;$env:Path","tool","run"]],
    segs: [
      {"lead":[],"words":["$Env:Path=C:\\bin;$env:Path","tool","run"],"ps":["Path","C:\\bin;$env:Path tool run"],"held":[],"inner":[["$Env:Path=C:\\bin;$env:Path","tool","run"]],"text":"$Env:Path=C:\\bin;$env:Path tool run","base":"bin;$env:path"},
    ],
    assigned: [["Path","C:\\bin;$env:Path"]],
  },
  {
    command: "set X=1; (export A=b; tool)",
    words: [["set","X=1"],["(export","A=b"],["tool)"]],
    expanded: [["set","X=1"],["(export","A=b"],["tool)"]],
    segs: [
      {"lead":[],"words":["set","X=1"],"ps":null,"held":[],"inner":[["set","X=1"]],"text":"set X=1","base":"set"},
      {"lead":["export","A=b"],"words":[],"ps":null,"held":[],"inner":[],"text":"","base":""},
      {"lead":[],"words":["tool"],"ps":null,"held":[],"inner":[["tool"]],"text":"tool","base":"tool"},
    ],
    assigned: [["X","1"],["A","b"]],
  },
  {
    command: "X=1 Y=2",
    words: [["X=1","Y=2"]],
    expanded: [["X=1","Y=2"]],
    segs: [
      {"lead":["X=1","Y=2"],"words":[],"ps":null,"held":[],"inner":[],"text":"","base":""},
    ],
    assigned: [["X","1"],["Y","2"]],
  },
  {
    command: "X=\"a b\" Y='c' tool Z=3",
    words: [["X=a b","Y=c","tool","Z=3"]],
    expanded: [["X=a b","Y=c","tool","Z=3"]],
    segs: [
      {"lead":["X=a b","Y=c"],"words":["tool","Z=3"],"ps":null,"held":[],"inner":[["tool","Z=3"]],"text":"tool Z=3","base":"tool"},
    ],
    assigned: [["X","a b"],["Y","c"]],
  },
  {
    command: "env FOO=1 BAR=2 tool --x; export PATH=/opt/bin:$PATH",
    words: [["env","FOO=1","BAR=2","tool","--x"],["export","PATH=/opt/bin:$PATH"]],
    expanded: [["env","FOO=1","BAR=2","tool","--x"],["export","PATH=/opt/bin:$PATH"]],
    segs: [
      {"lead":["env","FOO=1","BAR=2"],"words":["tool","--x"],"ps":null,"held":[],"inner":[["tool","--x"]],"text":"tool --x","base":"tool"},
      {"lead":["export","PATH=/opt/bin:$PATH"],"words":[],"ps":null,"held":[],"inner":[],"text":"","base":""},
    ],
    assigned: [["FOO","1"],["BAR","2"],["PATH","/opt/bin:$PATH"]],
  },
  {
    command: "time nohup tool run; ! grep -q x file; call build.bat; env; export",
    words: [["time","nohup","tool","run"],["!","grep","-q","x","file"],["call","build.bat"],["env"],["export"]],
    expanded: [["time","nohup","tool","run"],["!","grep","-q","x","file"],["call","build.bat"],["env"],["export"]],
    segs: [
      {"lead":["time","nohup"],"words":["tool","run"],"ps":null,"held":[],"inner":[["tool","run"]],"text":"tool run","base":"tool"},
      {"lead":["!"],"words":["grep","-q","x","file"],"ps":null,"held":[],"inner":[["grep","-q","x","file"]],"text":"grep -q x file","base":"grep"},
      {"lead":["call"],"words":["build.bat"],"ps":null,"held":[],"inner":[["build.bat"]],"text":"build.bat","base":"build.bat"},
      {"lead":["env"],"words":[],"ps":null,"held":[],"inner":[],"text":"","base":""},
      {"lead":["export"],"words":[],"ps":null,"held":[],"inner":[],"text":"","base":""},
    ],
    assigned: [],
  },
  {
    command: "\u00e9=1 tool; U\u00f1=2 tool; $env:\u00dcx = \"v\"; $env:N\u00e4me=\"w\"",
    words: [["\u00e9=1","tool"],["U\u00f1=2","tool"],["$env:\u00dcx","=","v"],["$env:N\u00e4me=w"]],
    expanded: [["\u00e9=1","tool"],["U\u00f1=2","tool"],["$env:\u00dcx","=","v"],["$env:N\u00e4me=w"]],
    segs: [
      {"lead":[],"words":["\u00e9=1","tool"],"ps":null,"held":[],"inner":[["\u00e9=1","tool"]],"text":"\u00e9=1 tool","base":"\u00e9=1"},
      {"lead":[],"words":["U\u00f1=2","tool"],"ps":null,"held":[],"inner":[["U\u00f1=2","tool"]],"text":"U\u00f1=2 tool","base":"u\u00f1=2"},
      {"lead":[],"words":["$env:\u00dcx","=","v"],"ps":null,"held":[],"inner":[["$env:\u00dcx","=","v"]],"text":"$env:\u00dcx = v","base":"$env:\u00fcx"},
      {"lead":[],"words":["$env:N\u00e4me=w"],"ps":["N\u00e4me","w"],"held":[],"inner":[["$env:N\u00e4me=w"]],"text":"$env:N\u00e4me=w","base":"$env:n\u00e4me=w"},
    ],
    assigned: [["U\u00f1","2"],["N\u00e4me","w"]],
  },
  {
    command: "& \"C:\\Games\\sim.exe\" -fast",
    words: [["&","C:\\Games\\sim.exe","-fast"]],
    expanded: [["&","C:\\Games\\sim.exe","-fast"]],
    segs: [
      {"lead":["&"],"words":["C:\\Games\\sim.exe","-fast"],"ps":null,"held":[],"inner":[["C:\\Games\\sim.exe","-fast"]],"text":"C:\\Games\\sim.exe -fast","base":"sim"},
    ],
    assigned: [],
  },
  {
    command: "& 'C:/x/tool.exe' run",
    words: [["&","C:/x/tool.exe","run"]],
    expanded: [["&","C:/x/tool.exe","run"]],
    segs: [
      {"lead":["&"],"words":["C:/x/tool.exe","run"],"ps":null,"held":[],"inner":[["C:/x/tool.exe","run"]],"text":"C:/x/tool.exe run","base":"tool"},
    ],
    assigned: [],
  },
  {
    command: "(cd a && git add b)",
    words: [["(cd","a"],["git","add","b)"]],
    expanded: [["(cd","a"],["git","add","b)"]],
    segs: [
      {"lead":[],"words":["cd","a"],"ps":null,"held":[],"inner":[["cd","a"]],"text":"cd a","base":"cd"},
      {"lead":[],"words":["git","add","b"],"ps":null,"held":[],"inner":[["git","add","b"]],"text":"git add b","base":"git"},
    ],
    assigned: [],
  },
  {
    command: "{ make; make install; }",
    words: [["{","make"],["make","install"],["}"]],
    expanded: [["{","make"],["make","install"],["}"]],
    segs: [
      {"lead":[],"words":["make"],"ps":null,"held":[],"inner":[["make"]],"text":"make","base":"make"},
      {"lead":[],"words":["make","install"],"ps":null,"held":[],"inner":[["make","install"]],"text":"make install","base":"make"},
      {"lead":[],"words":[],"ps":null,"held":[],"inner":[],"text":"","base":""},
    ],
    assigned: [],
  },
  {
    command: "(tool); ((a)); {tool}; foo(bar); echo (a b); x )",
    words: [["(tool)"],["((a))"],["{tool}"],["foo(bar)"],["echo","(a","b)"],["x",")"]],
    expanded: [["(tool)"],["((a))"],["{tool}"],["foo(bar)"],["echo","(a","b)"],["x",")"]],
    segs: [
      {"lead":[],"words":["tool"],"ps":null,"held":[],"inner":[["tool"]],"text":"tool","base":"tool"},
      {"lead":[],"words":["a"],"ps":null,"held":[],"inner":[["a"]],"text":"a","base":"a"},
      {"lead":[],"words":["tool"],"ps":null,"held":[],"inner":[["tool"]],"text":"tool","base":"tool"},
      {"lead":[],"words":["foo(bar)"],"ps":null,"held":[],"inner":[["foo(bar)"]],"text":"foo(bar)","base":"foo(bar)"},
      {"lead":[],"words":["echo","(a","b"],"ps":null,"held":[],"inner":[["echo","(a","b"]],"text":"echo (a b","base":"echo"},
      {"lead":[],"words":["x"],"ps":null,"held":[],"inner":[["x"]],"text":"x","base":"x"},
    ],
    assigned: [],
  },
  {
    command: "/usr/bin/Git.EXE status; .\\Scripts\\Tool.exe; C:\\a\\b.cmd",
    words: [["/usr/bin/Git.EXE","status"],[".\\Scripts\\Tool.exe"],["C:\\a\\b.cmd"]],
    expanded: [["/usr/bin/Git.EXE","status"],[".\\Scripts\\Tool.exe"],["C:\\a\\b.cmd"]],
    segs: [
      {"lead":[],"words":["/usr/bin/Git.EXE","status"],"ps":null,"held":[],"inner":[["/usr/bin/Git.EXE","status"]],"text":"/usr/bin/Git.EXE status","base":"git"},
      {"lead":[],"words":[".\\Scripts\\Tool.exe"],"ps":null,"held":[],"inner":[[".\\Scripts\\Tool.exe"]],"text":".\\Scripts\\Tool.exe","base":"tool"},
      {"lead":[],"words":["C:\\a\\b.cmd"],"ps":null,"held":[],"inner":[["C:\\a\\b.cmd"]],"text":"C:\\a\\b.cmd","base":"b.cmd"},
    ],
    assigned: [],
  },
  {
    command: "Set-Location \"C:\\work\\repo\"; git -C sub push -uf origin x",
    words: [["Set-Location","C:\\work\\repo"],["git","-C","sub","push","-uf","origin","x"]],
    expanded: [["Set-Location","C:\\work\\repo"],["git","-C","sub","push","-uf","origin","x"]],
    segs: [
      {"lead":[],"words":["Set-Location","C:\\work\\repo"],"ps":null,"held":[],"inner":[["Set-Location","C:\\work\\repo"]],"text":"Set-Location C:\\work\\repo","base":"set-location"},
      {"lead":[],"words":["git","-C","sub","push","-uf","origin","x"],"ps":null,"held":[],"inner":[["git","-C","sub","push","-uf","origin","x"]],"text":"git -C sub push -uf origin x","base":"git"},
    ],
    assigned: [],
  },
  {
    command: "powershell -NoProfile -Command \"git add apps\"",
    words: [["powershell","-NoProfile","-Command","git add apps"]],
    expanded: [["git","add","apps"]],
    segs: [
      {"lead":[],"words":["git","add","apps"],"ps":null,"held":[],"inner":[["git","add","apps"]],"text":"git add apps","base":"git"},
    ],
    assigned: [],
  },
  {
    command: "bash -c 'cd sub && git push --force'",
    words: [["bash","-c","cd sub && git push --force"]],
    expanded: [["cd","sub"],["git","push","--force"]],
    segs: [
      {"lead":[],"words":["cd","sub"],"ps":null,"held":[],"inner":[["cd","sub"]],"text":"cd sub","base":"cd"},
      {"lead":[],"words":["git","push","--force"],"ps":null,"held":[],"inner":[["git","push","--force"]],"text":"git push --force","base":"git"},
    ],
    assigned: [],
  },
  {
    command: "FOO=1 bash -lc \"make test; make lint\"",
    words: [["FOO=1","bash","-lc","make test; make lint"]],
    expanded: [["FOO=1","make","test"],["FOO=1","make","lint"]],
    segs: [
      {"lead":["FOO=1"],"words":["make","test"],"ps":null,"held":[],"inner":[["make","test"]],"text":"make test","base":"make"},
      {"lead":["FOO=1"],"words":["make","lint"],"ps":null,"held":[],"inner":[["make","lint"]],"text":"make lint","base":"make"},
    ],
    assigned: [["FOO","1"]],
  },
  {
    command: "sh -c \"echo hi\" && zsh -ic 'ls | wc -l'",
    words: [["sh","-c","echo hi"],["zsh","-ic","ls | wc -l"]],
    expanded: [["echo","hi"],["ls"],["wc","-l"]],
    segs: [
      {"lead":[],"words":["echo","hi"],"ps":null,"held":[],"inner":[["echo","hi"]],"text":"echo hi","base":"echo"},
      {"lead":[],"words":["ls"],"ps":null,"held":[],"inner":[["ls"]],"text":"ls","base":"ls"},
      {"lead":[],"words":["wc","-l"],"ps":null,"held":[],"inner":[["wc","-l"]],"text":"wc -l","base":"wc"},
    ],
    assigned: [],
  },
  {
    command: "pwsh -Command Get-ChildItem -Recurse; pwsh -c \"Write-Host hi; git push\"",
    words: [["pwsh","-Command","Get-ChildItem","-Recurse"],["pwsh","-c","Write-Host hi; git push"]],
    expanded: [["Get-ChildItem","-Recurse"],["Write-Host","hi"],["git","push"]],
    segs: [
      {"lead":[],"words":["Get-ChildItem","-Recurse"],"ps":null,"held":[],"inner":[["Get-ChildItem","-Recurse"]],"text":"Get-ChildItem -Recurse","base":"get-childitem"},
      {"lead":[],"words":["Write-Host","hi"],"ps":null,"held":[],"inner":[["Write-Host","hi"]],"text":"Write-Host hi","base":"write-host"},
      {"lead":[],"words":["git","push"],"ps":null,"held":[],"inner":[["git","push"]],"text":"git push","base":"git"},
    ],
    assigned: [],
  },
  {
    command: "cmd /C \"dir && echo done\"; cmd /c dir",
    words: [["cmd","/C","dir && echo done"],["cmd","/c","dir"]],
    expanded: [["dir"],["echo","done"],["dir"]],
    segs: [
      {"lead":[],"words":["dir"],"ps":null,"held":[],"inner":[["dir"]],"text":"dir","base":"dir"},
      {"lead":[],"words":["echo","done"],"ps":null,"held":[],"inner":[["echo","done"]],"text":"echo done","base":"echo"},
      {"lead":[],"words":["dir"],"ps":null,"held":[],"inner":[["dir"]],"text":"dir","base":"dir"},
    ],
    assigned: [],
  },
  {
    command: "bash -c \"bash -c 'git commit -m x; ls'\"",
    words: [["bash","-c","bash -c 'git commit -m x; ls'"]],
    expanded: [["git","commit","-m","x"],["ls"]],
    segs: [
      {"lead":[],"words":["git","commit","-m","x"],"ps":null,"held":[],"inner":[["git","commit","-m","x"]],"text":"git commit -m x","base":"git"},
      {"lead":[],"words":["ls"],"ps":null,"held":[],"inner":[["ls"]],"text":"ls","base":"ls"},
    ],
    assigned: [],
  },
  {
    command: "Bash.EXE -C \"a; b\"; bash -c; bash script.sh -c; dash -x -c \"p | q\" tail",
    words: [["Bash.EXE","-C","a; b"],["bash","-c"],["bash","script.sh","-c"],["dash","-x","-c","p | q","tail"]],
    expanded: [["a"],["b"],["bash","-c"],["bash","script.sh","-c"],["p"],["q","tail"]],
    segs: [
      {"lead":[],"words":["a"],"ps":null,"held":[],"inner":[["a"]],"text":"a","base":"a"},
      {"lead":[],"words":["b"],"ps":null,"held":[],"inner":[["b"]],"text":"b","base":"b"},
      {"lead":[],"words":["bash","-c"],"ps":null,"held":[],"inner":[["bash","-c"]],"text":"bash -c","base":"bash"},
      {"lead":[],"words":["bash","script.sh","-c"],"ps":null,"held":[],"inner":[["bash","script.sh","-c"]],"text":"bash script.sh -c","base":"bash"},
      {"lead":[],"words":["p"],"ps":null,"held":[],"inner":[["p"]],"text":"p","base":"p"},
      {"lead":[],"words":["q","tail"],"ps":null,"held":[],"inner":[["q","tail"]],"text":"q tail","base":"q"},
    ],
    assigned: [],
  },
  {
    command: "X=1 bash -c \"Y=2 tool; other\"",
    words: [["X=1","bash","-c","Y=2 tool; other"]],
    expanded: [["X=1","Y=2 tool; other","Y=2","tool"],["X=1","Y=2 tool; other","other"]],
    segs: [
      {"lead":["X=1","Y=2 tool; other","Y=2"],"words":["tool"],"ps":null,"held":[],"inner":[["tool"]],"text":"tool","base":"tool"},
      {"lead":["X=1","Y=2 tool; other"],"words":["other"],"ps":null,"held":[],"inner":[["other"]],"text":"other","base":"other"},
    ],
    assigned: [["X","1"],["Y","2 tool; other"]],
  },
  {
    command: "powershell -NoProfile -File scripts/run-tests.ps1",
    words: [["powershell","-NoProfile","-File","scripts/run-tests.ps1"]],
    expanded: [["powershell","-NoProfile","-File","scripts/run-tests.ps1"]],
    segs: [
      {"lead":[],"words":["powershell","-NoProfile","-File","scripts/run-tests.ps1"],"ps":null,"held":[],"inner":[["powershell","-NoProfile","-File","scripts/run-tests.ps1"]],"text":"powershell -NoProfile -File scripts/run-tests.ps1","base":"powershell"},
    ],
    assigned: [],
  },
  {
    command: "(bash -c 'a; b')",
    words: [["(bash","-c","a; b)"]],
    expanded: [["a"],["b"]],
    segs: [
      {"lead":[],"words":["a"],"ps":null,"held":[],"inner":[["a"]],"text":"a","base":"a"},
      {"lead":[],"words":["b"],"ps":null,"held":[],"inner":[["b"]],"text":"b","base":"b"},
    ],
    assigned: [],
  },
  {
    command: "aw lock run editor --for \"tests, 5 min\" -- powershell -NoProfile -File scripts/run-tests.ps1",
    words: [["aw","lock","run","editor","--for","tests, 5 min","--","powershell","-NoProfile","-File","scripts/run-tests.ps1"]],
    expanded: [["aw","lock","run","editor","--for","tests, 5 min","--","powershell","-NoProfile","-File","scripts/run-tests.ps1"]],
    segs: [
      {"lead":[],"words":["aw","lock","run","editor","--for","tests, 5 min","--","powershell","-NoProfile","-File","scripts/run-tests.ps1"],"ps":null,"held":["editor"],"inner":[["powershell","-NoProfile","-File","scripts/run-tests.ps1"]],"text":"aw lock run editor --for tests, 5 min -- powershell -NoProfile -File scripts/run-tests.ps1","base":"aw"},
    ],
    assigned: [],
  },
  {
    command: "aw lease gpu -- \"python train.py && python eval.py\"",
    words: [["aw","lease","gpu","--","python train.py && python eval.py"]],
    expanded: [["aw","lease","gpu","--","python train.py && python eval.py"]],
    segs: [
      {"lead":[],"words":["aw","lease","gpu","--","python train.py && python eval.py"],"ps":null,"held":[],"inner":[["python","train.py"],["python","eval.py"]],"text":"aw lease gpu -- python train.py && python eval.py","base":"aw"},
    ],
    assigned: [],
  },
  {
    command: "aw --json lock run sim -- aw lease gpu -- tool run",
    words: [["aw","--json","lock","run","sim","--","aw","lease","gpu","--","tool","run"]],
    expanded: [["aw","--json","lock","run","sim","--","aw","lease","gpu","--","tool","run"]],
    segs: [
      {"lead":[],"words":["aw","--json","lock","run","sim","--","aw","lease","gpu","--","tool","run"],"ps":null,"held":["sim"],"inner":[["tool","run"]],"text":"aw --json lock run sim -- aw lease gpu -- tool run","base":"aw"},
    ],
    assigned: [],
  },
  {
    command: "aw note add \"x -- y\"; aw status -- foo; aw lock run -- bare",
    words: [["aw","note","add","x -- y"],["aw","status","--","foo"],["aw","lock","run","--","bare"]],
    expanded: [["aw","note","add","x -- y"],["aw","status","--","foo"],["aw","lock","run","--","bare"]],
    segs: [
      {"lead":[],"words":["aw","note","add","x -- y"],"ps":null,"held":[],"inner":[["aw","note","add","x -- y"]],"text":"aw note add x -- y","base":"aw"},
      {"lead":[],"words":["aw","status","--","foo"],"ps":null,"held":[],"inner":[["aw","status","--","foo"]],"text":"aw status -- foo","base":"aw"},
      {"lead":[],"words":["aw","lock","run","--","bare"],"ps":null,"held":[],"inner":[["bare"]],"text":"aw lock run -- bare","base":"aw"},
    ],
    assigned: [],
  },
  {
    command: "python aw.py lock run db --ttl 5 -- ./migrate.sh; C:\\tools\\aw.cmd lock run r -- \"bash -c 'a; b'\"",
    words: [["python","aw.py","lock","run","db","--ttl","5","--","./migrate.sh"],["C:\\tools\\aw.cmd","lock","run","r","--","bash -c 'a; b'"]],
    expanded: [["python","aw.py","lock","run","db","--ttl","5","--","./migrate.sh"],["C:\\tools\\aw.cmd","lock","run","r","--","bash -c 'a; b'"]],
    segs: [
      {"lead":[],"words":["python","aw.py","lock","run","db","--ttl","5","--","./migrate.sh"],"ps":null,"held":["db"],"inner":[["./migrate.sh"]],"text":"python aw.py lock run db --ttl 5 -- ./migrate.sh","base":"python"},
      {"lead":[],"words":["C:\\tools\\aw.cmd","lock","run","r","--","bash -c 'a; b'"],"ps":null,"held":["r"],"inner":[["a"],["b"]],"text":"C:\\tools\\aw.cmd lock run r -- bash -c 'a; b'","base":"aw.cmd"},
    ],
    assigned: [],
  },
  {
    command: "AW_AGENT=a1 aw lock run editor -- 'X=1 tool a'",
    words: [["AW_AGENT=a1","aw","lock","run","editor","--","X=1 tool a"]],
    expanded: [["AW_AGENT=a1","aw","lock","run","editor","--","X=1 tool a"]],
    segs: [
      {"lead":["AW_AGENT=a1"],"words":["aw","lock","run","editor","--","X=1 tool a"],"ps":null,"held":["editor"],"inner":[["X=1","tool","a"]],"text":"aw lock run editor -- X=1 tool a","base":"aw"},
    ],
    assigned: [["AW_AGENT","a1"]],
  },
];

test("golden: shellWords", () => {
  for (const g of GOLDEN) assert.deepEqual(shellWords(g.command), g.words, g.command);
});

test("golden: expand", () => {
  for (const g of GOLDEN) assert.deepEqual(expand(shellWords(g.command)), g.expanded, g.command);
});

test("golden: splitLead, commandWords, textOf, baseName", () => {
  for (const g of GOLDEN) {
    g.expanded.forEach((segment, n) => {
      const want = g.segs[n];
      assert.deepEqual(splitLead(segment), { lead: want.lead, words: want.words }, g.command);
      assert.deepEqual(commandWords(segment), want.words, g.command);
      assert.equal(textOf(want.words), want.text, g.command);
      assert.equal(want.words.length ? baseName(want.words[0]) : "", want.base, g.command);
    });
  }
});

test("golden: psAssignment", () => {
  for (const g of GOLDEN) {
    for (const want of g.segs) {
      const got = psAssignment(want.words);
      assert.deepEqual(got && [got.name, got.value], want.ps, g.command);
    }
  }
});

test("golden: unwrap", () => {
  for (const g of GOLDEN) {
    for (const want of g.segs) {
      const got = unwrap(want.words, WRAPPER);
      assert.deepEqual(got.segments, want.inner, g.command);
      assert.deepEqual(held(got.wrappers), want.held, g.command);
    }
  }
});

test("golden: assignments", () => {
  for (const g of GOLDEN) assert.deepEqual([...assignments(g.expanded)], g.assigned, g.command);
});

test("the golden set covers every feature it is there for", () => {
  const all = GOLDEN.map((g) => g.command).join("\n\u0000\n");
  for (const feature of ["&&", "||", ";", "|", "\n", "\\\n", "`\r\n", "'", '"', "$(", "<<EOF", "<<-'END'", "@'\n", '@"\n',
    "$env:", "export ", "env ", "time ", "bash -c", "sh -c", "zsh -ic", "-lc", "powershell", "pwsh", "cmd /c", "lock run", "lease", "& "]) {
    assert.ok(all.includes(feature), `no golden command has ${JSON.stringify(feature)}`);
  }
  assert.ok(GOLDEN.length >= 60, `${GOLDEN.length} golden commands`);
});

test("a comment is dropped, with the quotes and operators it holds", () => {
  assert.deepEqual(shellWords("# don't stage everything\ngit add -A"), [["git", "add", "-A"]]);
  assert.deepEqual(shellWords("ls # then; git push -f"), [["ls"]]);
  assert.deepEqual(shellWords("ls;#x | y\npwd"), [["ls"], ["pwd"]]);
  assert.deepEqual(shellWords("# only a comment"), []);
  assert.deepEqual(shellWords("Get-ChildItem # it's \"all\" of them\r\ngit status"), [["Get-ChildItem"], ["git", "status"]]);
  assert.deepEqual(shellWords("cat <<EOF # the body follows\nx; y\nEOF\nls"), [["cat"], ["ls"]]);
});

test("a # inside a word, a quote or a substitution is not a comment", () => {
  assert.deepEqual(shellWords("curl https://example.test/#top; echo $# ${#a} a#b"),
    [["curl", "https://example.test/#top"], ["echo", "$#", "${#a}", "a#b"]]);
  assert.deepEqual(shellWords("git commit -m '#12 fix' \"# two\" ''#x"), [["git", "commit", "-m", "#12 fix", "# two", "#x"]]);
  assert.deepEqual(shellWords("echo $(wc -l # c\n) x"), [["echo", "$(wc -l # c\n)", "x"]]);
});

test("a lone & ends a command, but not as a call operator or in a redirection", () => {
  assert.deepEqual(shellWords("sleep 5 & git push --force"), [["sleep", "5"], ["git", "push", "--force"]]);
  assert.deepEqual(shellWords("serve& curl localhost"), [["serve"], ["curl", "localhost"]]);
  assert.deepEqual(shellWords("tool &"), [["tool"]]);
  assert.deepEqual(shellWords("x 2>&1 & y >&2 & z &>out &>>log <&3"), [["x", "2>&1"], ["y", ">&2"], ["z", "&>out", "&>>log", "<&3"]]);
  assert.deepEqual(shellWords("& 'C:\\tools\\run.exe' a; & b"), [["&", "C:\\tools\\run.exe", "a"], ["&", "b"]]);
  assert.deepEqual(shellWords("a |& b"), [["a"], ["&", "b"]]);
  assert.deepEqual(shellWords("curl a\\&b 'c & d' \"e & f\""), [["curl", "a\\&b", "c & d", "e & f"]]);
  assert.deepEqual(shellWords("if ($ok) { & ./build.ps1 }").map((s) => commandWords(s)), [["if", "($ok)", "{"], ["./build.ps1"]]);
});

test("<<< feeds one word and has no body to cut", () => {
  assert.deepEqual(shellWords("base64 -d <<< SGVsbG8\ngit push --force"), [["base64", "-d", "<<<", "SGVsbG8"], ["git", "push", "--force"]]);
  assert.deepEqual(shellWords("grep x <<<\"a; b\" && ls"), [["grep", "x", "<<<a; b"], ["ls"]]);
  assert.deepEqual(shellWords("echo $(cat <<< word; date) x"), [["echo", "$(cat <<< word; date)", "x"]]);
});

test("splitCommand gives each segment the operator after it", () => {
  assert.deepEqual(splitCommand("a 1 && b || c; d | e & f\ng"), [
    { words: ["a", "1"], op: "&&" }, { words: ["b"], op: "||" }, { words: ["c"], op: ";" }, { words: ["d"], op: "|" },
    { words: ["e"], op: "&" }, { words: ["f"], op: "\n" }, { words: ["g"], op: "" },
  ]);
  assert.deepEqual(splitCommand("git commit -m \"a && b; c\" ;\n\n git push"), [
    { words: ["git", "commit", "-m", "a && b; c"], op: ";" }, { words: ["git", "push"], op: "" },
  ]);
  assert.deepEqual(splitCommand("cat <<EOF | wc -l\nrm -rf x && y\nEOF\nls"), [
    { words: ["cat"], op: "|" }, { words: ["wc", "-l"], op: "\n" }, { words: ["ls"], op: "" },
  ]);
  assert.deepEqual(splitCommand(""), []);
  assert.deepEqual(splitCommand(" ;; \n"), []);
});

test("splitCommand reads the line handed to a shell, and the last inner segment takes the outer operator", () => {
  assert.deepEqual(splitCommand("X=1 bash -c 'cd sub && git push' || echo no"), [
    { words: ["X=1", "cd", "sub"], op: "&&" }, { words: ["X=1", "git", "push"], op: "||" }, { words: ["echo", "no"], op: "" },
  ]);
  assert.deepEqual(splitCommand("powershell -NoProfile -Command \"Set-Location C:\\work\\repo; git commit -m x\"; git push"), [
    { words: ["Set-Location", "C:\\work\\repo"], op: ";" }, { words: ["git", "commit", "-m", "x"], op: ";" }, { words: ["git", "push"], op: "" },
  ]);
  assert.deepEqual(splitCommand("sh -c \"bash -lc 'a | b'\" && c").map((s) => s.op), ["|", "&&", ""]);
  assert.deepEqual(splitCommand("bash build.sh -x && pwsh -File run.ps1"), [
    { words: ["bash", "build.sh", "-x"], op: "&&" }, { words: ["pwsh", "-File", "run.ps1"], op: "" },
  ]);
});

test("leaders and shells are the caller's to set", () => {
  assert.deepEqual(commandWords(["sudo", "X=1", "git", "push"]), ["sudo", "X=1", "git", "push"]);
  assert.deepEqual(commandWords(["sudo", "X=1", "git", "push"], [...LEADERS, "sudo"]), ["git", "push"]);
  assert.deepEqual(splitLead(["env", "A=1", "time", "tool"], []), { lead: [], words: ["env", "A=1", "time", "tool"] });
  const shells = { ...SHELLS, fish: ["-c"] };
  assert.deepEqual(shellWords("fish -c 'a; b'"), [["fish", "-c", "a; b"]]);
  assert.deepEqual(expand(shellWords("fish -c 'a; b'")), [["fish", "-c", "a; b"]]);
  assert.deepEqual(expand(shellWords("fish -c 'a; b'"), { shells }), [["a"], ["b"]]);
  assert.deepEqual(splitCommand("sudo fish -c 'a; b'", { shells, leaders: ["sudo"] }).map((s) => s.words), [["a"], ["b"]]);
  assert.deepEqual(expand([["constructor", "-c", "a; b"]]), [["constructor", "-c", "a; b"]]);
});

test("a long chain of nested shells is read to a fixed depth and never throws", () => {
  const segments = splitCommand(`${"sh -c ".repeat(400)}tool`);
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0].words.slice(-3), ["sh", "-c", "tool"]);
  assert.deepEqual(splitCommand(`${"sh -c ".repeat(10)}tool`), [{ words: ["tool"], op: "" }]);
});

test("unwrap peels only what the wrapper says runs a command", () => {
  const words = ["run-locked", "db", "--", "tool", "a"];
  assert.deepEqual(unwrap(words), { wrappers: [], segments: [words] });
  assert.deepEqual(unwrap(words, { names: ["run-locked"] }), { wrappers: [["db"]], segments: [["tool", "a"]] });
  assert.deepEqual(unwrap(words, { names: ["run-locked"], wraps: () => false }), { wrappers: [], segments: [words] });
  assert.deepEqual(unwrap(["C:\\bin\\Run-Locked.exe", "db", "--", "a && b | c"], { names: ["run-locked"] }),
    { wrappers: [["db"]], segments: [["a"], ["b"], ["c"]] });
  assert.deepEqual(unwrap(["run-locked", "db", "--"], { names: ["run-locked"] }), { wrappers: [["db"]], segments: [] });
  assert.deepEqual(unwrap([], { names: ["run-locked"] }), { wrappers: [], segments: [] });
});

test("assignments is a Map: a variable named like an object property stays a key", () => {
  const set = assignments(shellWords("__proto__=1 constructor=2 tool; $env:toString = 'x'"));
  assert.deepEqual([...set], [["__proto__", "1"], ["constructor", "2"], ["toString", "x"]]);
  assert.equal(assignments([]).get("constructor"), undefined);
});

test("gitCommand finds git, its -C folders and its sub-command", () => {
  assert.deepEqual(gitCommand(["git", "--no-pager", "-c", "a=b", "-C", "x", "--git-dir", "g", "push", "--force", "origin"]),
    { at: 0, dirs: ["x"], verb: "push", args: ["--force", "origin"] });
  assert.deepEqual(gitCommand(["git", "-C", "a", "-C", "..\\b", "commit", "-m", "git push"]),
    { at: 0, dirs: ["a", "..\\b"], verb: "commit", args: ["-m", "git push"] });
  assert.deepEqual(gitCommand(["sudo", "C:\\Program Files\\Git\\bin\\Git.EXE", "status"]), { at: 1, dirs: [], verb: "status", args: [] });
  assert.deepEqual(gitCommand(["git"]), { at: 0, dirs: [], verb: "", args: [] });
  assert.deepEqual(gitCommand(["git", "-C"]), { at: 0, dirs: [""], verb: "", args: [] });
  assert.equal(gitCommand(["gitk", "--all"]), null);
  assert.equal(gitCommand([]), null);
  assert.deepEqual(gitCommand(commandWords(shellWords("GIT_TRACE=1 git -C sub push -uf origin x")[0])),
    { at: 0, dirs: ["sub"], verb: "push", args: ["-uf", "origin", "x"] });
});

/** Where each segment of a command runs, as "first word -> folder" lines. */
const cwds = (command, cwd, options) => trackCwd(splitCommand(command), cwd, options)
  .map((s) => `${commandWords(s.words)[0] ?? ""} -> ${s.cwd}`);

test("trackCwd: cd moves the segments after it, git -C its own segment only", () => {
  assert.deepEqual(trackCwd(splitCommand("cd sub && git commit -m x; git push"), "/srv/app"), [
    { words: ["cd", "sub"], op: "&&", cwd: "/srv/app" },
    { words: ["git", "commit", "-m", "x"], op: ";", cwd: "/srv/app/sub" },
    { words: ["git", "push"], op: "", cwd: "/srv/app/sub" },
  ]);
  assert.deepEqual(cwds("git -C ../other -C deep push && git status", "/srv/app"), ["git -> /srv/other/deep", "git -> /srv/app"]);
  assert.deepEqual(cwds("sudo git -C /srv/other push | cat", "/srv/app"), ["sudo -> /srv/other", "cat -> /srv/app"]);
  assert.deepEqual(cwds("X=1 cd sub; cd -P ../..; cd ./a//b/; ls; cd ../../../..; ls", "/srv/app"),
    ["cd -> /srv/app", "cd -> /srv/app/sub", "cd -> /srv", "ls -> /srv/a/b", "cd -> /srv/a/b", "ls -> /"]);
  assert.deepEqual(cwds("cd 'my dir' && git -C x status", "/srv/app"), ["cd -> /srv/app", "git -> /srv/app/my dir/x"]);
  assert.deepEqual(cwds("git status", "/srv/app"), ["git -> /srv/app"]);
  assert.deepEqual(trackCwd([], "/srv/app"), []);
});

test("trackCwd: pushd and popd, and the end of a subshell, move back", () => {
  assert.deepEqual(cwds("pushd pkg && npm test && popd && git commit -m x; popd; ls", "/srv/app"),
    ["pushd -> /srv/app", "npm -> /srv/app/pkg", "popd -> /srv/app/pkg", "git -> /srv/app", "popd -> /srv/app", "ls -> null"]);
  assert.deepEqual(cwds("(cd a && make) && git commit -m x", "/srv/app"), ["cd -> /srv/app", "make -> /srv/app/a", "git -> /srv/app"]);
  assert.deepEqual(cwds("(cd a; (cd b; ls); ls); ls", "/srv"), ["cd -> /srv", "cd -> /srv/a", "ls -> /srv/a/b", "ls -> /srv/a", "ls -> /srv"]);
  assert.deepEqual(cwds("{ cd a; make; }; ls", "/srv"), ["cd -> /srv", "make -> /srv/a", " -> /srv/a", "ls -> /srv/a"]);
  assert.deepEqual(cwds("cd a; echo \"$(pwd)\"; ls", "/srv"), ["cd -> /srv", "echo -> /srv/a", "ls -> /srv/a"]);
});

test("trackCwd: a folder the text does not name is null until an absolute path names one", () => {
  assert.deepEqual(cwds("cd $DIR && git push; cd sub; ls; cd /opt/x; git push", "/srv/app"),
    ["cd -> /srv/app", "git -> null", "cd -> null", "ls -> null", "cd -> null", "git -> /opt/x"]);
  assert.deepEqual(cwds("cd - && git push", "/srv/app"), ["cd -> /srv/app", "git -> null"]);
  assert.deepEqual(cwds("cd; ls", "/srv/app"), ["cd -> /srv/app", "ls -> null"]);
  assert.deepEqual(cwds("cd \"$(git rev-parse --show-toplevel)\"; cd `pwd`; ls", "/srv/app"), ["cd -> /srv/app", "cd -> null", "ls -> null"]);
  assert.deepEqual(cwds("git -C \"$ROOT\" push; git push", "/srv/app"), ["git -> null", "git -> /srv/app"]);
  assert.deepEqual(cwds("cd sub; git -C /opt/x status", null), ["cd -> null", "git -> /opt/x"]);
  assert.deepEqual(cwds("cd ~/proj && git push; cd ~other; ls", "/srv/app"), ["cd -> /srv/app", "git -> null", "cd -> null", "ls -> null"]);
  assert.deepEqual(cwds("cd ~/proj && git push; cd ~; ls", "/srv/app", { home: "/srv/me" }),
    ["cd -> /srv/app", "git -> /srv/me/proj", "cd -> /srv/me/proj", "ls -> /srv/me"]);
});

test("trackCwd: Windows paths and PowerShell", () => {
  assert.deepEqual(cwds("Set-Location C:\\work\\repo\\sub; git commit -m x", "C:\\work\\repo"),
    ["Set-Location -> C:\\work\\repo", "git -> C:/work/repo/sub"]);
  assert.deepEqual(cwds("cd ..\\other; git -C ..\\third status; git push", "C:\\work\\repo"),
    ["cd -> C:\\work\\repo", "git -> C:/work/third", "git -> C:/work/other"]);
  assert.deepEqual(cwds("Push-Location -Path 'D:\\Other Repo'; git commit -m x; Pop-Location; git push", "C:\\work\\repo"),
    ["Push-Location -> C:\\work\\repo", "git -> D:/Other Repo", "Pop-Location -> D:/Other Repo", "git -> C:\\work\\repo"]);
  assert.deepEqual(cwds("sl src; & 'C:\\Program Files\\Git\\bin\\git.exe' -c a=b -C lib commit", "C:/work/repo"),
    ["sl -> C:/work/repo", "C:\\Program Files\\Git\\bin\\git.exe -> C:/work/repo/src/lib"]);
  assert.deepEqual(cwds("$env:GIT_TRACE = \"1\"; SET-LOCATION ..; git status", "C:\\work\\repo"),
    ["$env:GIT_TRACE -> C:\\work\\repo", "SET-LOCATION -> C:\\work\\repo", "git -> C:/work"]);
  assert.deepEqual(cwds("powershell -Command \"cd C:\\work\\repo; git push\"", "D:\\"), ["cd -> D:\\", "git -> C:/work/repo"]);
  assert.deepEqual(cwds("cd D:; cd ..; ls", "C:\\work"), ["cd -> C:\\work", "cd -> D:/", "ls -> D:/"]);
  assert.deepEqual(cwds("cd \\\\server\\share\\x; cd ..; ls", "C:\\work"), ["cd -> C:\\work", "cd -> //server/share/x", "ls -> //server/share"]);
  assert.deepEqual(cwds("cd ~\\src; ls", "C:\\work", { home: "C:\\me" }), ["cd -> C:\\work", "ls -> C:/me/src"]);
});

test("trackCwd: /c/dir is a drive from a drive folder, a plain path anywhere else", () => {
  assert.deepEqual(cwds("cd /d/tools && git push; cd /c; ls", "C:\\work\\repo"), ["cd -> C:\\work\\repo", "git -> d:/tools", "cd -> d:/tools", "ls -> c:/"]);
  assert.deepEqual(cwds("cd /d/tools && git push", "/srv/app"), ["cd -> /srv/app", "git -> /d/tools"]);
  assert.deepEqual(cwds("git -C /c/work/other status", "c:/work/repo"), ["git -> c:/work/other"]);
});

test("trackCwd: a relative start stays relative", () => {
  assert.deepEqual(cwds("cd sub/../x; cd ../..; ls; cd ..; ls", ""), ["cd -> ", "cd -> x", "ls -> ..", "cd -> ..", "ls -> ../.."]);
  assert.deepEqual(cwds("cd sub; ls", "packages/app"), ["cd -> packages/app", "ls -> packages/app/sub"]);
});
