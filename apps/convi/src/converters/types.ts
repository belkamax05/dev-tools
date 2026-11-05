/** An external program a converter shells out to. */
export interface Tool {
  /** Executable name, looked up on PATH. */
  bin: string;
  /** How to get it, shown when it is missing — convi never installs anything itself. */
  hint: string;
}

export interface ConvertJob {
  /** Absolute path of the file to convert; it exists and is a file. */
  input: string;
  /** Absolute path to write; its directory exists. */
  output: string;
  /** The `--name=value` flags of the command line (`--name` alone is `"true"`). */
  options: Record<string, string>;
}

export interface Converter {
  /** What it is called on the command line: `convi md-to-pdf <input>`. */
  name: string;
  /** Input extension, dot included — also what a bare `convi <input> <output>` matches on. */
  from: string;
  /** Output extension, dot included. */
  to: string;
  description: string;
  /**
   * The tools this job needs. Gets the input so a converter can ask only for what that file uses
   * (md-to-pdf wants mermaid-filter only when there is a mermaid block).
   */
  tools: (job: ConvertJob) => Promise<Tool[]>;
  /**
   * Any other check before starting, for a need that is not one fixed tool (one of several
   * browsers, say). @throws With what is missing and how to get it
   */
  check?: (job: ConvertJob) => Promise<void>;
  convert: (job: ConvertJob) => Promise<void>;
}
