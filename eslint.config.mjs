import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {files:["scripts/*.cjs"],rules:{"@typescript-eslint/no-require-imports":"off"}},
  // Module boundary (CLAUDE.md §3): lib/modules/<module> must not import another module.
  {files:["lib/modules/**/*.ts"],rules:{"import/no-restricted-paths":["error",{zones:[{target:'./lib/modules/commercial',from:'./lib/modules',except:['./commercial'],message:'Modules may not import other modules. Put shared logic in lib/platform or build a seam in lib/seams.'},{target:'./lib/modules/estimating',from:'./lib/modules',except:['./estimating'],message:'Modules may not import other modules. Put shared logic in lib/platform or build a seam in lib/seams.'},{target:'./lib/modules/field',from:'./lib/modules',except:['./field'],message:'Modules may not import other modules. Put shared logic in lib/platform or build a seam in lib/seams.'},{target:'./lib/modules/hseq',from:'./lib/modules',except:['./hseq'],message:'Modules may not import other modules. Put shared logic in lib/platform or build a seam in lib/seams.'},{target:'./lib/modules/pipeline',from:'./lib/modules',except:['./pipeline'],message:'Modules may not import other modules. Put shared logic in lib/platform or build a seam in lib/seams.'},{target:'./lib/modules/projects',from:'./lib/modules',except:['./projects'],message:'Modules may not import other modules. Put shared logic in lib/platform or build a seam in lib/seams.'}]}]}},
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
