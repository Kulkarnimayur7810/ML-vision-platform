import "./env";
import { sql, closeSql } from "../lib/db";
import { migrate } from "../lib/migrations";
migrate(sql()).then(async (a) => { console.log("applied:", a.join(", ") || "nothing new"); await closeSql(); })
  .catch((e) => { console.error(e); process.exit(1); });
