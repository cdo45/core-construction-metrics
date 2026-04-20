import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST() {
  try {
    const sql = getDb();

    // ── Tables ────────────────────────────────────────────────────────────────

    await sql`
      CREATE TABLE IF NOT EXISTS categories (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        color      VARCHAR(7)   NOT NULL DEFAULT '#000000',
        created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS gl_accounts (
        id             SERIAL PRIMARY KEY,
        account_no     INT          NOT NULL,
        division       VARCHAR(4)   NOT NULL DEFAULT '',
        description    VARCHAR(200) NOT NULL,
        normal_balance VARCHAR(6)   NOT NULL CHECK (normal_balance IN ('debit','credit')),
        category_id    INT          REFERENCES categories(id),
        is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
        is_non_cash    BOOLEAN      NOT NULL DEFAULT FALSE,
        is_pl_flow     BOOLEAN      NOT NULL DEFAULT FALSE,
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT gl_accounts_acct_div_key UNIQUE (account_no, division)
      )
    `;

    // Migrations for DBs that pre-date these columns
    await sql`ALTER TABLE gl_accounts ADD COLUMN IF NOT EXISTS division    VARCHAR(4)  NOT NULL DEFAULT ''    `;
    await sql`ALTER TABLE gl_accounts ADD COLUMN IF NOT EXISTS is_non_cash BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE gl_accounts ADD COLUMN IF NOT EXISTS is_pl_flow  BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE gl_accounts DROP CONSTRAINT IF EXISTS gl_accounts_account_no_key`;
    await sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'gl_accounts_acct_div_key'
        ) THEN
          ALTER TABLE gl_accounts ADD CONSTRAINT gl_accounts_acct_div_key UNIQUE (account_no, division);
        END IF;
      END $$
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS weekly_balances (
        id             SERIAL PRIMARY KEY,
        week_ending    DATE         NOT NULL,
        gl_account_id  INT          NOT NULL REFERENCES gl_accounts(id),
        beg_balance    NUMERIC(15,2) NOT NULL DEFAULT 0,
        end_balance    NUMERIC(15,2) NOT NULL DEFAULT 0,
        period_debit   NUMERIC(15,2) NOT NULL DEFAULT 0,
        period_credit  NUMERIC(15,2) NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        UNIQUE (week_ending, gl_account_id)
      )
    `;
    await sql`ALTER TABLE weekly_balances ALTER COLUMN beg_balance  TYPE NUMERIC(15,2) USING beg_balance::NUMERIC(15,2)`;
    await sql`ALTER TABLE weekly_balances ALTER COLUMN end_balance  TYPE NUMERIC(15,2) USING end_balance::NUMERIC(15,2)`;
    await sql`ALTER TABLE weekly_balances ADD COLUMN IF NOT EXISTS period_debit  NUMERIC(15,2) NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE weekly_balances ADD COLUMN IF NOT EXISTS period_credit NUMERIC(15,2) NOT NULL DEFAULT 0`;

    await sql`
      CREATE TABLE IF NOT EXISTS bid_activity (
        id                   SERIAL PRIMARY KEY,
        week_ending          DATE         NOT NULL UNIQUE,
        bids_submitted_count INT          NOT NULL DEFAULT 0,
        bids_submitted_value NUMERIC(15,2) NOT NULL DEFAULT 0,
        bids_won_count       INT          NOT NULL DEFAULT 0,
        bids_won_value       NUMERIC(15,2) NOT NULL DEFAULT 0,
        notes                TEXT,
        created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `;
    await sql`ALTER TABLE bid_activity ALTER COLUMN bids_submitted_value TYPE NUMERIC(15,2) USING bids_submitted_value::NUMERIC(15,2)`;
    await sql`ALTER TABLE bid_activity ALTER COLUMN bids_won_value        TYPE NUMERIC(15,2) USING bids_won_value::NUMERIC(15,2)`;

    await sql`
      CREATE TABLE IF NOT EXISTS weekly_notes (
        id          SERIAL PRIMARY KEY,
        week_ending DATE NOT NULL UNIQUE,
        doc_link    TEXT,
        summary     TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS import_log (
        id            SERIAL       PRIMARY KEY,
        import_type   VARCHAR(20)  NOT NULL,
        week_ending   DATE         NOT NULL,
        status        VARCHAR(10)  NOT NULL CHECK (status IN ('success','failed')),
        rows_imported INT          NOT NULL DEFAULT 0,
        total_debit   NUMERIC(15,2),
        total_credit  NUMERIC(15,2),
        net_total     NUMERIC(15,2),
        warnings      JSONB,
        error_message TEXT,
        source_file   VARCHAR(255),
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `;
    // Update constraint to allow trial_balance type (safe to run repeatedly)
    await sql`ALTER TABLE import_log DROP CONSTRAINT IF EXISTS import_log_import_type_check`;

    await sql`CREATE INDEX IF NOT EXISTS idx_il_week ON import_log(week_ending)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_il_type ON import_log(import_type)`;

    await sql`
      CREATE TABLE IF NOT EXISTS app_settings (
        key        VARCHAR(50) PRIMARY KEY,
        value      TEXT        NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`
      INSERT INTO app_settings (key, value)
      VALUES ('cash_safety_floor', '500000')
      ON CONFLICT (key) DO NOTHING
    `;

    // ── Categories ────────────────────────────────────────────────────────────

    const cats = [
      { name: "Cash on Hand",           sort_order: 1, color: "#10B981" },
      { name: "Who Owes Us",            sort_order: 2, color: "#3B82F6" },
      { name: "Who We Owe (Current)",   sort_order: 3, color: "#EF4444" },
      { name: "Who We Owe (Long-Term)", sort_order: 4, color: "#991B1B" },
      { name: "Payroll Liabilities",    sort_order: 5, color: "#F59E0B" },
      { name: "Payroll (Field)",        sort_order: 6, color: "#14B8A6" },
      { name: "Overhead (Div 99)",      sort_order: 7, color: "#7B3FA0" },
    ];

    for (const c of cats) {
      await sql`
        INSERT INTO categories (name, sort_order, color)
        SELECT ${c.name}, ${c.sort_order}, ${c.color}
        WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = ${c.name})
      `;
    }

    // ── GL Accounts ───────────────────────────────────────────────────────────
    // Each entry: [account_no, division, description, normal_balance, category_name, is_pl_flow]

    type AcctRow = [number, string, string, "debit" | "credit", string, boolean];

    const accounts: AcctRow[] = [
      // ── Cash on Hand (13) ──────────────────────────────────────────────────
      [1005, "", "PETTY CASH",                 "debit", "Cash on Hand", false],
      [1011, "", "APCASH COMMUNITY BK",         "debit", "Cash on Hand", false],
      [1019, "", "401K CASH SUSPENSE",          "debit", "Cash on Hand", false],
      [1021, "", "COMM BK OPERATING",           "debit", "Cash on Hand", false],
      [1023, "", "CBB PAYROLL",                 "debit", "Cash on Hand", false],
      [1024, "", "COMM BK FIELD",               "debit", "Cash on Hand", false],
      [1025, "", "COMM BK MM",                  "debit", "Cash on Hand", false],
      [1026, "", "CHASE BK AP CASH",            "debit", "Cash on Hand", false],
      [1027, "", "CHASE BK OPERATING",          "debit", "Cash on Hand", false],
      [1028, "", "CHASE BK PAYROLL",            "debit", "Cash on Hand", false],
      [1029, "", "CHASE BK FIELD",              "debit", "Cash on Hand", false],
      [1030, "", "CHASE 401K CASH SUSPENSE",    "debit", "Cash on Hand", false],
      [1120, "", "UNDEPOSITED FUNDS",            "debit", "Cash on Hand", false],

      // ── Who Owes Us (5) ────────────────────────────────────────────────────
      [1105, "", "A/R - CONTRACTS",             "debit", "Who Owes Us", false],
      [1110, "", "A/R - RETENTION",             "debit", "Who Owes Us", false],
      [1115, "", "A/R - OTHER",                 "debit", "Who Owes Us", false],
      [1116, "", "A/R - OTHER FIRE",            "debit", "Who Owes Us", false],
      [1225, "", "PREPAID EXPENSES",            "debit", "Who Owes Us", false],

      // ── Who We Owe (49) ────────────────────────────────────────────────────
      [2005, "", "A/P - TRADE",                             "credit", "Who We Owe (Current)", false],
      [2010, "", "A/P - RETENTION",                         "credit", "Who We Owe (Current)", false],
      [2015, "", "ACCRUED EXPENSES",                         "credit", "Who We Owe (Current)", false],
      [2020, "", "ACCRUED VACATION",                         "credit", "Who We Owe (Current)", false],
      [2040, "", "QUINN CAT CREDIT CARD 6307",               "credit", "Who We Owe (Current)", false],
      [2050, "", "LINE OF CREDIT",                           "credit", "Who We Owe (Current)", false],
      [2300, "", "INSURANCE FINANCING",                      "credit", "Who We Owe (Current)", false],
      [2600, "", "CONTRACT LOSS ACCRUAL",                    "credit", "Who We Owe (Current)", false],
      [2405, "", "CURR.PORT.- NP 2016 KENWORTHS",            "credit", "Who We Owe (Current)", false],
      [2406, "", "CURR PORT-22 NP WIRTGEN W120FI",           "credit", "Who We Owe (Current)", false],
      [2407, "", "CURR. PORT.-NP 2022 GMC SIERRA",           "credit", "Who We Owe (Current)", false],
      [2410, "", "CURR. PORT.-NP 2022 ROAD WIDEN",           "credit", "Who We Owe (Current)", false],
      [2411, "", "CURR POR LEASE WIRTGEN W120XTI",           "credit", "Who We Owe (Current)", false],
      [2412, "", "CURR. PORT-2020 ASPHALT PAVER",            "credit", "Who We Owe (Current)", false],
      [2413, "", "CURR PORT NP 2021 JD TRACTOR",             "credit", "Who We Owe (Current)", false],
      [2414, "", "CURR PORT 2023 GMC SIERRA 2500",           "credit", "Who We Owe (Current)", false],
      [2415, "", "CURR PORT 2023 CHEVY SILVERADO",           "credit", "Who We Owe (Current)", false],
      [2416, "", "CURR PORT 2020 CAT ASPHALT CB7",           "credit", "Who We Owe (Current)", false],
      [2417, "", "CURR PORT 2023 FORD F-350 DRW",            "credit", "Who We Owe (Current)", false],
      [2418, "", "NP ST 2023 CAT AP455",                     "credit", "Who We Owe (Current)", false],
      [2419, "", "NP ST 2022 CAT SKID STEER",                "credit", "Who We Owe (Current)", false],
      [2420, "", "NP ST 2023 FORD F-350 SRW",                "credit", "Who We Owe (Current)", false],
      [2421, "", "NP ST 2024 CHEVY SILVERADO",               "credit", "Who We Owe (Current)", false],
      [2422, "", "NP ST 2024 CHEVY SILVERADO",               "credit", "Who We Owe (Current)", false],
      [2424, "", "NP ST 2022 CRACK POT",                     "credit", "Who We Owe (Current)", false],
      [2425, "", "NP ST HD12 DUAL DRUM ROLL",                "credit", "Who We Owe (Current)", false],
      [2426, "", "NP ST 2024 FORD F250 SRW",                 "credit", "Who We Owe (Current)", false],
      [2427, "", "NP ST 2024 FORD F350 DRW",                 "credit", "Who We Owe (Current)", false],
      [2428, "", "NP ST W 210 FL",                           "credit", "Who We Owe (Current)", false],
      [2429, "", "NP ST 22 RAM 5500",                        "credit", "Who We Owe (Current)", false],
      [2430, "", "NP ST 24 CHEVY SILV 2500HD",               "credit", "Who We Owe (Current)", false],
      [2431, "", "NP ST 24 CHEVY SIL 2500HD",                "credit", "Who We Owe (Current)", false],
      [2432, "", "NP ST 24 FORD F550 DRW",                   "credit", "Who We Owe (Current)", false],
      [2433, "", "NP ST WIRTGEN W 120 4'MILL",               "credit", "Who We Owe (Current)", false],
      [2434, "", "NP ST 24 BOMAG PAVER",                     "credit", "Who We Owe (Current)", false],
      [2436, "", "NP ST 24 FD F350 SRW",                     "credit", "Who We Owe (Current)", false],
      [2437, "", "NP ST 2016 FORD F650",                     "credit", "Who We Owe (Current)", false],
      [2438, "", "NP ST 24 FORD F350 DRW",                   "credit", "Who We Owe (Current)", false],
      [2440, "", "NP ST 24 GMC SIERRA 2500HD",               "credit", "Who We Owe (Current)", false],
      [2442, "", "NP ST 25 GMC SIERRA 2500",                 "credit", "Who We Owe (Current)", false],
      [2443, "", "NP ST 2025 KENTWORTH T380",                "credit", "Who We Owe (Current)", false],
      [2444, "", "NP ST 2024 FORD F-350 SRW",                "credit", "Who We Owe (Current)", false],
      [2445, "", "NP ST 2024 FORD F-550 DRW",                "credit", "Who We Owe (Current)", false],
      [2446, "", "NP ST 23 WIRTGEN W210 FI MILL",            "credit", "Who We Owe (Current)", false],
      [2447, "", "NP ST 22 ROADTEC SB3000",                  "credit", "Who We Owe (Current)", false],
      [2448, "", "NP ST 2025 GMC SIERRA 3500",               "credit", "Who We Owe (Current)", false],
      [2449, "", "NP ST 25 BOMAG PAVER",                     "credit", "Who We Owe (Current)", false],
      [2450, "", "NP ST 2024 FORD SUPER DUTY DRW",           "credit", "Who We Owe (Current)", false],
      [2452, "", "NP ST 2026 KENWORTH T680",                 "credit", "Who We Owe (Current)", false],

      // ── Who We Owe (Current) — 4 additional accounts ──────────────────────
      [2404, "", "CURR PORT NP EQUIP 2404",                 "credit", "Who We Owe (Current)", false],
      [2408, "", "CURR PORT NP EQUIP 2408",                 "credit", "Who We Owe (Current)", false],
      [2409, "", "CURR PORT NP EQUIP 2409",                 "credit", "Who We Owe (Current)", false],
      [2435, "", "NP ST EQUIP 2435",                        "credit", "Who We Owe (Current)", false],

      // ── Who We Owe (Long-Term) (38) ────────────────────────────────────────
      [2400, "", "LT NOTE PAYABLE 2400",                    "credit", "Who We Owe (Long-Term)", false],
      [2401, "", "LT NOTE PAYABLE 2401",                    "credit", "Who We Owe (Long-Term)", false],
      [2402, "", "LT NOTE PAYABLE 2402",                    "credit", "Who We Owe (Long-Term)", false],
      [2507, "", "LT NOTE PAYABLE 2507",                    "credit", "Who We Owe (Long-Term)", false],
      [2566, "", "LT NOTE PAYABLE 2566",                    "credit", "Who We Owe (Long-Term)", false],
      [2568, "", "LT NOTE PAYABLE 2568",                    "credit", "Who We Owe (Long-Term)", false],
      [2569, "", "LT NOTE PAYABLE 2569",                    "credit", "Who We Owe (Long-Term)", false],
      [2570, "", "LT NOTE PAYABLE 2570",                    "credit", "Who We Owe (Long-Term)", false],
      [2571, "", "LT NOTE PAYABLE 2571",                    "credit", "Who We Owe (Long-Term)", false],
      [2572, "", "LT NOTE PAYABLE 2572",                    "credit", "Who We Owe (Long-Term)", false],
      [2573, "", "LT NOTE PAYABLE 2573",                    "credit", "Who We Owe (Long-Term)", false],
      [2574, "", "LT NOTE PAYABLE 2574",                    "credit", "Who We Owe (Long-Term)", false],
      [2575, "", "LT NOTE PAYABLE 2575",                    "credit", "Who We Owe (Long-Term)", false],
      [2576, "", "LT NOTE PAYABLE 2576",                    "credit", "Who We Owe (Long-Term)", false],
      [2577, "", "LT NOTE PAYABLE 2577",                    "credit", "Who We Owe (Long-Term)", false],
      [2578, "", "LT NOTE PAYABLE 2578",                    "credit", "Who We Owe (Long-Term)", false],
      [2579, "", "LT NOTE PAYABLE 2579",                    "credit", "Who We Owe (Long-Term)", false],
      [2580, "", "LT NOTE PAYABLE 2580",                    "credit", "Who We Owe (Long-Term)", false],
      [2581, "", "LT NOTE PAYABLE 2581",                    "credit", "Who We Owe (Long-Term)", false],
      [2582, "", "LT NOTE PAYABLE 2582",                    "credit", "Who We Owe (Long-Term)", false],
      [2584, "", "LT NOTE PAYABLE 2584",                    "credit", "Who We Owe (Long-Term)", false],
      [2585, "", "LT NOTE PAYABLE 2585",                    "credit", "Who We Owe (Long-Term)", false],
      [2586, "", "LT NOTE PAYABLE 2586",                    "credit", "Who We Owe (Long-Term)", false],
      [2587, "", "LT NOTE PAYABLE 2587",                    "credit", "Who We Owe (Long-Term)", false],
      [2588, "", "LT NOTE PAYABLE 2588",                    "credit", "Who We Owe (Long-Term)", false],
      [2589, "", "LT NOTE PAYABLE 2589",                    "credit", "Who We Owe (Long-Term)", false],
      [2590, "", "LT NOTE PAYABLE 2590",                    "credit", "Who We Owe (Long-Term)", false],
      [2591, "", "LT NOTE PAYABLE 2591",                    "credit", "Who We Owe (Long-Term)", false],
      [2592, "", "LT NOTE PAYABLE 2592",                    "credit", "Who We Owe (Long-Term)", false],
      [2593, "", "LT NOTE PAYABLE 2593",                    "credit", "Who We Owe (Long-Term)", false],
      [2594, "", "LT NOTE PAYABLE 2594",                    "credit", "Who We Owe (Long-Term)", false],
      [2596, "", "LT NOTE PAYABLE 2596",                    "credit", "Who We Owe (Long-Term)", false],
      [2597, "", "LT NOTE PAYABLE 2597",                    "credit", "Who We Owe (Long-Term)", false],
      [2598, "", "LT NOTE PAYABLE 2598",                    "credit", "Who We Owe (Long-Term)", false],
      [2800, "", "LT LIABILITY 2800",                       "credit", "Who We Owe (Long-Term)", false],
      [2801, "", "LT LIABILITY 2801",                       "credit", "Who We Owe (Long-Term)", false],
      [2804, "", "LT LIABILITY 2804",                       "credit", "Who We Owe (Long-Term)", false],
      [2805, "", "LT LIABILITY 2805",                       "credit", "Who We Owe (Long-Term)", false],

      // ── Payroll Liabilities (13) ────────────────────────────────────────────
      [2120, "", "UNION BENEFITS CLEARING",    "credit", "Payroll Liabilities", false],
      [2138, "", "W/C ACCRUAL",                "credit", "Payroll Liabilities", false],
      [2144, "", "PAYROLL TAXES PAYABLE (P4C)","credit", "Payroll Liabilities", false],
      [2146, "", "SUTA PAYABLE",               "credit", "Payroll Liabilities", false],
      [2150, "", "FED INCOME TAX W/H",         "credit", "Payroll Liabilities", false],
      [2152, "", "FICA W/H",                   "credit", "Payroll Liabilities", false],
      [2153, "", "401K PLAN (EMPLOYEE)",       "credit", "Payroll Liabilities", false],
      [2154, "", "STATE INCOME TAX W/H",       "credit", "Payroll Liabilities", false],
      [2155, "", "401K PLAN (EMPLOYER)",       "credit", "Payroll Liabilities", false],
      [2156, "", "STATE DISABILITY W/H",       "credit", "Payroll Liabilities", false],
      [2160, "", "GARNISHMENTS PAYABLE",       "credit", "Payroll Liabilities", false],
      [2165, "", "ACCRUED P/R EXPENSES",       "credit", "Payroll Liabilities", false],
      [2166, "", "BONUS ACCRUAL",              "credit", "Payroll Liabilities", false],

      // ── Payroll (Field) (26) ────────────────────────────────────────────────
      [5101, "10", "DIRECT LABOR",        "debit", "Payroll (Field)", true],
      [5101, "20", "DIRECT LABOR",        "debit", "Payroll (Field)", true],
      [5101, "22", "DIRECT LABOR",        "debit", "Payroll (Field)", true],
      [5101, "23", "DIRECT LABOR",        "debit", "Payroll (Field)", true],
      [5210, "10", "PAYROLL TAXES",       "debit", "Payroll (Field)", true],
      [5210, "20", "PAYROLL TAXES",       "debit", "Payroll (Field)", true],
      [5210, "22", "PAYROLL TAXES",       "debit", "Payroll (Field)", true],
      [5210, "23", "PAYROLL TAXES",       "debit", "Payroll (Field)", true],
      [5220, "10", "W/C INSURANCE",       "debit", "Payroll (Field)", true],
      [5220, "20", "W/C INSURANCE",       "debit", "Payroll (Field)", true],
      [5220, "22", "W/C INSURANCE",       "debit", "Payroll (Field)", true],
      [5220, "23", "W/C INSURANCE",       "debit", "Payroll (Field)", true],
      [5250, "10", "UNION BENEFITS",      "debit", "Payroll (Field)", true],
      [5250, "20", "UNION BENEFITS",      "debit", "Payroll (Field)", true],
      [5250, "22", "UNION BENEFITS",      "debit", "Payroll (Field)", true],
      [5250, "23", "UNION BENEFITS",      "debit", "Payroll (Field)", true],
      [5260, "10", "SUBSISTENCE",         "debit", "Payroll (Field)", true],
      [7260, "10", "G&A WAGES",           "debit", "Payroll (Field)", true],
      [7260, "20", "G&A WAGES",           "debit", "Payroll (Field)", true],
      [7260, "23", "G&A WAGES",           "debit", "Payroll (Field)", true],
      [7280, "10", "PAYROLL TAX EXPENSE", "debit", "Payroll (Field)", true],
      [7280, "20", "PAYROLL TAX EXPENSE", "debit", "Payroll (Field)", true],
      [7280, "23", "PAYROLL TAX EXPENSE", "debit", "Payroll (Field)", true],
      [7290, "10", "W/C INSURANCE",       "debit", "Payroll (Field)", true],
      [7290, "20", "W/C INSURANCE",       "debit", "Payroll (Field)", true],
      [7290, "23", "W/C INSURANCE",       "debit", "Payroll (Field)", true],

      // ── Overhead (Div 99) (38) ──────────────────────────────────────────────
      [5101, "99", "DIRECT LABOR",                        "debit", "Overhead (Div 99)", true],
      [5250, "99", "UNION BENEFITS",                      "debit", "Overhead (Div 99)", true],
      [5322, "99", "HIGHWAY",                             "debit", "Overhead (Div 99)", true],
      [6010, "99", "AUTOS-FUEL&LUBRICANT",                "debit", "Overhead (Div 99)", true],
      [6050, "99", "ALLOCATED EQ. COSTS",                 "debit", "Overhead (Div 99)", true],
      [6080, "99", "INDIRECT LABOR",                      "debit", "Overhead (Div 99)", true],
      [6100, "99", "P/R TAXES",                           "debit", "Overhead (Div 99)", true],
      [6110, "99", "W/C INSURANCE",                       "debit", "Overhead (Div 99)", true],
      [6130, "99", "UNION BENEFITS",                      "debit", "Overhead (Div 99)", true],
      [6150, "99", "REPAIRS - PARTS",                     "debit", "Overhead (Div 99)", true],
      [6160, "99", "REPAIRS - OUTSIDE",                   "debit", "Overhead (Div 99)", true],
      [6190, "99", "OTHER",                               "debit", "Overhead (Div 99)", true],
      [7000, "99", "OFFICE-SUPPLIES&EXP",                 "debit", "Overhead (Div 99)", true],
      [7010, "99", "OFFICE-RENT",                         "debit", "Overhead (Div 99)", true],
      [7020, "99", "OFFICE-JNTRL&RPR/MNT",               "debit", "Overhead (Div 99)", true],
      [7030, "99", "OFFICE-POSTAGE",                      "debit", "Overhead (Div 99)", true],
      [7040, "99", "OFFICE-UTILITIES",                    "debit", "Overhead (Div 99)", true],
      [7050, "99", "OFFICE-TELEPHONE",                    "debit", "Overhead (Div 99)", true],
      [7060, "99", "OFFICE-BIDDING EXP",                  "debit", "Overhead (Div 99)", true],
      [7075, "99", "FOUNDATION SYSTEM FEES",              "debit", "Overhead (Div 99)", true],
      [7080, "99", "GEN. LIAB. INSURANCE",                "debit", "Overhead (Div 99)", true],
      [7100, "99", "BANK SERVICE CHARGES",                "debit", "Overhead (Div 99)", true],
      [7120, "99", "EDUCATIONAL EXPENSES",                "debit", "Overhead (Div 99)", true],
      [7130, "99", "ACCOUNTING FEES",                     "debit", "Overhead (Div 99)", true],
      [7135, "99", "PAYROLL PROCESSING FEES",             "debit", "Overhead (Div 99)", true],
      [7140, "99", "LEGAL FEES",                          "debit", "Overhead (Div 99)", true],
      [7165, "99", "MEAL EXP",                            "debit", "Overhead (Div 99)", true],
      [7170, "99", "ENTERTAINMENT EXP",                   "debit", "Overhead (Div 99)", true],
      [7190, "99", "DUES & SUBSCRIPTIONS",                "debit", "Overhead (Div 99)", true],
      [7200, "99", "LICENSE",                             "debit", "Overhead (Div 99)", true],
      [7230, "99", "INTEREST EXPENSE & FIN CHARGES",      "debit", "Overhead (Div 99)", true],
      [7260, "99", "G&A WAGES",                           "debit", "Overhead (Div 99)", true],
      [7280, "99", "PAYROLL TAX EXPENSE",                 "debit", "Overhead (Div 99)", true],
      [7290, "99", "W/C INSURANCE",                       "debit", "Overhead (Div 99)", true],
      [7300, "99", "GROUP HEALTH INS",                    "debit", "Overhead (Div 99)", true],
      [7320, "99", "401K (CO.Paid) Plan",                 "debit", "Overhead (Div 99)", true],
      [7350, "99", "INSURANCE EXPENSE",                   "debit", "Overhead (Div 99)", true],
      [8010, "99", "REIMBURSABLE EXPENSE",                "debit", "Overhead (Div 99)", true],
    ];

    for (const [account_no, division, description, normal_balance, category, is_pl_flow] of accounts) {
      await sql`
        INSERT INTO gl_accounts
          (account_no, division, description, normal_balance, category_id, is_pl_flow)
        SELECT
          ${account_no as number},
          ${division   as string},
          ${description as string},
          ${normal_balance as string},
          (SELECT id FROM categories WHERE name = ${category as string} LIMIT 1),
          ${is_pl_flow as boolean}
        WHERE NOT EXISTS (
          SELECT 1 FROM gl_accounts
          WHERE account_no = ${account_no as number}
            AND division   = ${division   as string}
        )
      `;
    }

    return NextResponse.json(
      { success: true, message: "Database seeded successfully." },
      { status: 200 },
    );
  } catch (err) {
    console.error("Seed error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
