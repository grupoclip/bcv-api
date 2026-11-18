// bcv-today-widget: <bcv-rate>, the BCV Today exchange-rate web component.
// Importing this module defines the element (once; a second copy of the script is a no-op).
import { BcvRate } from "./element.ts";

export { BcvRate };
export const VERSION: string = __VERSION__;

if (typeof customElements !== "undefined" && !customElements.get("bcv-rate")) {
  customElements.define("bcv-rate", BcvRate);
}

declare global {
  interface HTMLElementTagNameMap {
    "bcv-rate": BcvRate;
  }
}
