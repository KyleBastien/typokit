import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://typokit.github.io",
  integrations: [
    starlight({
      title: "TypoKit",
      social: {
        github: "https://github.com/typokit/typokit",
      },
      sidebar: [
        {
          label: "Getting Started",
          items: [{ label: "Welcome", slug: "" }],
        },
      ],
    }),
  ],
});
