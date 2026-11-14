'use strict';
// Languages fixlock's structural matching understands. Each entry says how to read a file: comment
// styles, string rules, keywords, and whether indentation or letter case carry meaning. Adding a
// language is usually one entry here; files that match nothing fall back to text matching.
//
// Fields (all optional except files):
//   files      extensions (".py"), compound endings (".blade.php") or exact file names ("Dockerfile")
//   line       line-comment starters                  block   [open, close, nests?] block comments
//   quotes     characters that open strings (default " ' `)
//   multiline  quotes whose strings may span lines (default `)
//   triple     """ / ''' strings                      regex   JS-style /regex/ literals
//   indent     indentation is part of the logic (Python, YAML…) → indent/dedent tokens
//   fold       case-insensitive language (SQL, Fortran…) → words compared in lower case
//   hashSpace  "#" starts a comment only at line start or after whitespace (shells, YAML)
//   dash       identifiers may contain "-" (CSS, Lisp)
//   css        property names are fixed; only $var / @var / --var are renameable
//   markup     HTML/XML-like: tags, attributes, {{ }} template expressions, <script>/<style>
//   expr       language of template expressions / <script> in markup (default js)
//   kw         keywords (never treated as renameable names); default: a broad common set

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

const KW_COMMON = 'abstract and as assert async await base break case catch class const continue def default defer ' +
  'del delete do elif else end enum except export extends false final finally fn for foreach from func function ' +
  'get go if impl implements import in instanceof interface is lambda let loop match mod module mut namespace ' +
  'new nil none not null of or override package pass private protected pub public raise readonly record ref ' +
  'require return select self set static struct super switch this throw throws trait true try type typeof ' +
  'undefined unless until use val var void when where while with yield True False None nullptr elsif begin ' +
  'rescue ensure then fun object companion sealed data inline internal lateinit unsafe crate dyn';
const KW = {
  js: 'async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while with yield',
  ts: 'abstract any as asserts boolean declare enum implements infer interface is keyof namespace never number object private protected public readonly satisfies string symbol type unique unknown',
  java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new null package permits private protected public record return sealed short static strictfp super switch synchronized this throw throws transient true false try var void volatile while yield',
  kotlin: 'abstract annotation as break by catch class companion const constructor continue crossinline data do else enum external false final finally for fun if import in infix init inline inner interface internal is lateinit noinline null object open operator out override package private protected public reified return sealed super suspend this throw true try typealias val var vararg when where while',
  csharp: 'abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly record ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile when where while with yield',
  go: 'break case chan const continue default defer else fallthrough false for func go goto if import interface iota map nil package range return select struct switch true type var',
  rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  swift: 'actor any as associatedtype async await break case catch class continue default defer deinit do else enum extension fallthrough false fileprivate for func guard if import in init inout internal is let nil open operator private protocol public repeat rethrows return self Self some static struct subscript super switch throw throws true try typealias var where while',
  dart: 'abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for get if implements import in interface is late library mixin new null on operator part required rethrow return sealed set static super switch this throw true try typedef var void when while with yield',
  scala: 'abstract case catch class def do else enum export extends false final finally for forSome given if implicit import lazy match new null object override package private protected return sealed super then this throw trait true try type using val var while with yield',
  c: 'auto bool break case char const continue default do double else enum extern false float for goto if inline int long nullptr register restrict return short signed sizeof static struct switch true typedef union unsigned void volatile while class namespace template typename public private protected virtual override new delete this throw try catch using operator friend constexpr noexcept',
  php: 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends false final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new null or print private protected public readonly require require_once return static switch this throw trait true try unset use var while xor yield',
  python: 'and as assert async await break case class continue def del elif else except False finally for from global if import in is lambda match None nonlocal not or pass raise return self True try while with yield',
  ruby: 'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield',
  shell: 'case do done elif else esac fi for function if in local export readonly return select then time until while declare set unset shift source',
  sql: 'add all alter and any as asc begin between by case check column commit constraint create cross database default delete desc distinct drop else end exists false foreign from full grant group having if in index inner insert intersect into is join key left like limit merge not null offset on or order outer primary references returning revoke right rollback select set table then true truncate union unique update using values view when where with',
  lua: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while',
  haskell: 'case class data default deriving do else forall if import in infix infixl infixr instance let module newtype of qualified then type where',
  elixir: 'after and catch cond def defp defmacro defmodule defstruct do else end false fn for if import in nil not or quote raise receive require rescue true try unless unquote use when with',
  lisp: 'def defn defn- defun defmacro defvar defparameter let let* lambda fn if when unless cond case do progn setq setf quote and or not nil t true false ns require import loop recur',
  css: 'important',
};
const kwFor = (...names) => words(names.map((n) => KW[n] || n).join(' '));

const C = { line: ['//'], block: [['/*', '*/']] };
const HASH = { line: ['#'] };
const TEMPLATE_COMMENTS = [['<!--', '-->'], ['{{!--', '--}}'], ['{{/*', '*/}}'], ['{{!', '}}'], ['{#', '#}'], ['<%#', '%>'], ['<%--', '--%>'], ['@*', '*@'], ['<#--', '-->'], ['{{--', '--}}']];

const LANGS = {
  // JavaScript family
  js: { ...C, regex: true, files: ['.js', '.jsx', '.mjs', '.cjs', '.es6'], kw: kwFor('js') },
  ts: { ...C, regex: true, files: ['.ts', '.tsx', '.mts', '.cts'], kw: kwFor('js', 'ts') },
  json: { ...C, files: ['.json', '.jsonc', '.json5', '.webmanifest', '.babelrc', '.eslintrc', '.prettierrc'], kw: words('true false null') },
  // C-style languages
  java: { ...C, triple: true, files: ['.java', '.jav'], kw: kwFor('java') },
  kotlin: { ...C, block: [['/*', '*/', true]], triple: true, files: ['.kt', '.kts'], kw: kwFor('kotlin') },
  scala: { ...C, block: [['/*', '*/', true]], triple: true, files: ['.scala', '.sc', '.sbt'], kw: kwFor('scala') },
  groovy: { ...C, triple: true, multiline: ['`'], files: ['.groovy', '.gradle', '.gvy', 'Jenkinsfile', '.jenkinsfile'], kw: kwFor('java') },
  csharp: { ...C, triple: true, verbatim: true, files: ['.cs', '.csx'], kw: kwFor('csharp') },
  go: { ...C, files: ['.go'], kw: kwFor('go') },
  rust: { ...C, block: [['/*', '*/', true]], rawRust: true, charQuote: true, files: ['.rs'], kw: kwFor('rust') },
  swift: { ...C, block: [['/*', '*/', true]], triple: true, files: ['.swift'], kw: kwFor('swift') },
  dart: { ...C, triple: true, files: ['.dart'], kw: kwFor('dart') },
  c: { ...C, rawCpp: true, files: ['.c', '.h', '.cc', '.cpp', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.h++', '.ino', '.cu', '.cuh', '.m', '.mm', '.ipp', '.tpp'], kw: kwFor('c') },
  zig: { line: ['//'], files: ['.zig', '.zon'] },
  d: { ...C, block: [['/*', '*/'], ['/+', '+/', true]], files: ['.d'] },
  solidity: { ...C, files: ['.sol'] },
  shader: { ...C, files: ['.glsl', '.vert', '.frag', '.geom', '.comp', '.hlsl', '.wgsl', '.metal', '.shader', '.cginc'] },
  verilog: { ...C, files: ['.v', '.sv', '.svh', '.vh'] },
  proto: { ...C, files: ['.proto', '.thrift', '.prisma', '.capnp', '.avdl'] },
  cstyle: { ...C, files: ['.cls', '.trigger', '.hx', '.vala', '.gleam', '.odin', '.carbon', '.move', '.cairo', '.bal', '.cue', '.as', '.re', '.res', '.pde', '.qml', '.kt.kts'] },
  php: { line: ['//', '#'], block: [['/*', '*/']], multiline: ['"', "'", '`'], files: ['.php', '.phtml', '.php3', '.php4', '.php5', '.phps', '.inc'], kw: kwFor('php') },
  // config / infra with C and # comments
  hcl: { line: ['#', '//'], block: [['/*', '*/']], files: ['.tf', '.tfvars', '.hcl', '.nomad', '.pkr.hcl'] },
  jsonnet: { line: ['#', '//'], block: [['/*', '*/']], files: ['.jsonnet', '.libsonnet'] },
  nix: { line: ['#'], block: [['/*', '*/']], multiline: ["''", '"'], files: ['.nix'] },
  // # comment languages
  python: { ...HASH, triple: true, indent: true, prefixes: true, files: ['.py', '.pyi', '.pyw', '.pyx', '.pxd', '.bzl', '.star', '.gd', '.mojo', '.sage', 'BUILD', 'BUILD.bazel', 'WORKSPACE', 'WORKSPACE.bazel', 'MODULE.bazel', 'SConstruct', 'SConscript', 'Tiltfile'], kw: kwFor('python') },
  ruby: { ...HASH, block: [['=begin', '=end']], regex: true, multiline: ['"', "'", '`'], files: ['.rb', '.rake', '.gemspec', '.ru', '.podspec', '.jbuilder', '.thor', 'Gemfile', 'Rakefile', 'Podfile', 'Fastfile', 'Appfile', 'Brewfile', 'Vagrantfile', 'Guardfile', 'Capfile', 'Dangerfile', 'Berksfile'], kw: kwFor('ruby') },
  crystal: { ...HASH, regex: true, multiline: ['"'], files: ['.cr'], kw: kwFor('ruby') },
  elixir: { ...HASH, triple: true, multiline: ['"'], files: ['.ex', '.exs', '.heex'], kw: kwFor('elixir') },
  julia: { ...HASH, block: [['#=', '=#', true]], triple: true, files: ['.jl'] },
  r: { ...HASH, multiline: ['"', "'"], files: ['.r', '.rmd', '.rprofile'] },
  perl: { ...HASH, block: [['=pod', '=cut'], ['=head1', '=cut']], regex: true, multiline: ['"', "'"], files: ['.pl', '.pm', '.t', '.raku', '.rakumod', '.p6'] },
  tcl: { ...HASH, hashSpace: true, files: ['.tcl', '.tk'] },
  nim: { ...HASH, block: [['#[', ']#', true]], triple: true, indent: true, files: ['.nim', '.nims', '.nimble'] },
  coffee: { ...HASH, block: [['###', '###']], triple: true, indent: true, files: ['.coffee', '.litcoffee', '.cson'] },
  powershell: { ...HASH, block: [['<#', '#>']], multiline: ['"', "'"], fold: true, files: ['.ps1', '.psm1', '.psd1'] },
  shell: { ...HASH, hashSpace: true, multiline: ['"', "'"], files: ['.sh', '.bash', '.zsh', '.ksh', '.fish', '.bats', '.envrc', '.bashrc', '.zshrc', '.bash_profile', '.profile', '.zprofile', 'PKGBUILD', 'APKBUILD'], kw: kwFor('shell') },
  dockerfile: { ...HASH, hashSpace: true, multiline: ['"', "'"], fold: true, files: ['Dockerfile', 'Containerfile', '.dockerfile', '.containerfile'] },
  make: { ...HASH, hashSpace: true, files: ['Makefile', 'makefile', 'GNUmakefile', '.mk', '.mak', 'Justfile', 'justfile', '.just'] },
  cmake: { ...HASH, block: [['#[[', ']]']], fold: true, files: ['CMakeLists.txt', '.cmake'] },
  yaml: { ...HASH, hashSpace: true, indent: true, multiline: ['"', "'"], files: ['.yml', '.yaml', '.sls', 'Procfile', '.clang-format'] },
  toml: { ...HASH, triple: true, files: ['.toml', 'Pipfile', 'Cargo.lock.toml'] },
  ini: { line: ['#', ';'], hashSpace: true, files: ['.ini', '.cfg', '.conf', '.properties', '.editorconfig', '.gitconfig', '.npmrc', '.env', '.env.example', '.env.local', '.env.development', '.env.production', '.env.test', 'Caddyfile', '.htaccess', '.service', '.desktop'] },
  graphql: { ...HASH, triple: true, files: ['.graphql', '.gql', '.graphqls'] },
  awk: { ...HASH, files: ['.awk'] },
  puppet: { ...HASH, block: [['/*', '*/']], files: ['.pp', '.epp'] },
  // -- comment languages
  sql: { line: ['--'], block: [['/*', '*/']], multiline: ["'", '"'], fold: true, files: ['.sql', '.psql', '.pgsql', '.mysql', '.ddl', '.dml', '.hql', '.bq', '.pls', '.pkb', '.pks', '.prc', '.fnc', '.trg', '.tsql', '.cql'], kw: kwFor('sql') },
  lua: { line: ['--'], block: [['--[[', ']]'], ['--[==[', ']==]']], longStrings: true, files: ['.lua', '.luau', '.rockspec', '.p8'], kw: kwFor('lua') },
  haskell: { line: ['--'], block: [['{-', '-}', true]], quotes: ['"'], files: ['.hs', '.lhs', '.elm', '.purs', '.idr', '.agda', '.dhall'], kw: kwFor('haskell') },
  ada: { line: ['--'], fold: true, quotes: ['"'], files: ['.adb', '.ads', '.ada', '.vhd', '.vhdl'] },
  // other comment styles
  ocaml: { block: [['(*', '*)', true]], quotes: ['"'], files: ['.ml', '.mli', '.mll', '.mly'] },
  fsharp: { line: ['//'], block: [['(*', '*)', true]], quotes: ['"'], triple: true, files: ['.fs', '.fsi', '.fsx'] },
  pascal: { line: ['//'], block: [['{', '}'], ['(*', '*)']], quotes: ["'"], fold: true, files: ['.pas', '.dpr', '.lpr', '.dfm'] },
  lisp: { line: [';'], block: [['#|', '|#', true]], quotes: ['"'], multiline: ['"'], dash: true, files: ['.lisp', '.lsp', '.cl', '.el', '.scm', '.ss', '.rkt', '.clj', '.cljs', '.cljc', '.edn', '.fnl', '.hy', '.janet'], kw: kwFor('lisp') },
  erlang: { line: ['%'], quotes: ['"'], files: ['.erl', '.hrl', '.app.src', '.escript'] },
  matlab: { line: ['%'], block: [['%{', '%}']], quotes: ['"'], files: ['.matlab', '.octave'] },
  latex: { line: ['%'], quotes: [], files: ['.tex', '.sty', '.cls.tex', '.bib'] },
  fortran: { line: ['!'], quotes: ['"', "'"], fold: true, files: ['.f', '.f90', '.f95', '.f03', '.f08', '.for', '.ftn'] },
  vb: { line: ["'"], quotes: ['"'], fold: true, files: ['.vb', '.bas', '.vbs', '.vba', '.frm'] },
  // stylesheets
  css: { block: [['/*', '*/']], css: true, dash: true, files: ['.css', '.pcss', '.postcss', '.wxss'], kw: kwFor('css') },
  scss: { line: ['//'], block: [['/*', '*/']], css: true, dash: true, files: ['.scss', '.less', '.styl', '.stylus'], kw: kwFor('css') },
  sass: { line: ['//'], block: [['/*', '*/']], css: true, dash: true, indent: true, files: ['.sass'], kw: kwFor('css') },
  // markup and templates (Angular, Vue, Svelte, Astro, Django/Jinja, Handlebars, ERB, Razor, Blade, JSP, Thymeleaf…)
  html: { markup: true, fold: true, block: TEMPLATE_COMMENTS, expr: 'ts', files: ['.html', '.htm', '.xhtml', '.shtml', '.vue', '.svelte', '.astro', '.hbs', '.handlebars', '.mustache', '.j2', '.jinja', '.jinja2', '.njk', '.nunjucks', '.twig', '.liquid', '.ejs', '.erb', '.html.erb', '.cshtml', '.razor', '.vbhtml', '.blade.php', '.jsp', '.jspx', '.tag', '.ftl', '.ftlh', '.gohtml', '.tmpl', '.tpl', '.mjml', '.html.heex', '.leex', '.eex', '.jte', '.cfm', '.marko', '.riot'] },
  xml: { markup: true, block: [['<!--', '-->']], expr: 'js', files: ['.xml', '.xsd', '.xsl', '.xslt', '.plist', '.csproj', '.vbproj', '.fsproj', '.vcxproj', '.props', '.targets', '.resx', '.xaml', '.axaml', '.storyboard', '.xib', '.wsdl', '.nuspec', '.config', '.manifest', '.rss', '.atom', '.kml', '.gpx', '.svg', '.xlf', '.xliff', '.iml', '.jelly', '.tld', '.fxml', '.launch'] },
};

for (const [id, spec] of Object.entries(LANGS)) {
  spec.id = id;
  spec.line = spec.line || [];
  spec.block = spec.block || [];
  spec.quotes = spec.quotes || ['"', "'", '`'];
  spec.multiline = spec.multiline || ['`'];
  spec.kw = spec.kw || words(KW_COMMON);
  if (spec.fold) spec.kw = new Set([...spec.kw].map((w) => w.toLowerCase()));
}

// file name → language: exact names first, then the longest matching ending (".blade.php" before ".php")
const BY_NAME = new Map();
const ENDINGS = [];
for (const spec of Object.values(LANGS)) {
  for (const f of spec.files) {
    if (f.startsWith('.')) ENDINGS.push([f.toLowerCase(), spec.id]);
    else BY_NAME.set(f, spec.id);
  }
}
ENDINGS.sort((a, b) => b[0].length - a[0].length);

/** Language id for a file path, or null (text matching). */
function detect(file) {
  const base = String(file || '').split(/[\\/]/).pop();
  if (!base) return null;
  if (BY_NAME.has(base)) return BY_NAME.get(base);
  const lower = base.toLowerCase();
  if (/^dockerfile[.-]/i.test(base) || /^containerfile[.-]/i.test(base)) return 'dockerfile';
  if (/^\.env(\.|$)/.test(base)) return 'ini';
  for (const [end, id] of ENDINGS) if (lower.endsWith(end)) return id;
  return null;
}

function spec(id) { return LANGS[id] || null; }

/** All languages, for docs and `fixlock languages`. */
function list() {
  return Object.values(LANGS).map((s) => ({ id: s.id, files: s.files, indent: !!s.indent, fold: !!s.fold, markup: !!s.markup }));
}

module.exports = { detect, spec, list, LANGS };
