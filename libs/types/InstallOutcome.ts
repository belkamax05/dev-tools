//? What `ensureInstalled` had to do, so a caller can stay quiet on the common path and only
//? announce the install that actually happened.
type InstallOutcome = 'present' | 'installed';

//? `export default InstallOutcome` is rejected under `verbatimModuleSyntax` — a default export has
//? to reference a value, and this is only a type. Aliasing it to `default` keeps the folder's
//? one-default-export-per-file shape.
export type { InstallOutcome as default };
