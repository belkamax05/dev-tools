export default interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}
