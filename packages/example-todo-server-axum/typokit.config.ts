import { axumPlugin } from "@typokit/plugin-axum";

export default {
  plugins: [axumPlugin({ db: "sqlx" })],
};
