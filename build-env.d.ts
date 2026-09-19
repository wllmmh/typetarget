// Minimal typing for the two `node:fs` functions vite.config.ts uses, so the build
// config typechecks without adding @types/node as a dependency.
declare module "node:fs" {
  export const existsSync: (path: string) => boolean;
  export const readFileSync: (path: string) => Uint8Array;
}
