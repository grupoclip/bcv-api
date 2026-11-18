// Build-time declarations: CSS files are inlined as minified strings and the version is injected by tsup.
declare module "*.css?text" {
  const css: string;
  export default css;
}

declare const __VERSION__: string;
