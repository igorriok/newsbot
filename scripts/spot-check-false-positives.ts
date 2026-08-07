import { config } from "../src/config";
import { classifyArticle, type ClassifyResult } from "../src/classifier/client";

/**
 * Pre-deploy manual spot-check (NOT part of the automated test suite):
 * runs the Bug-2 false-positive fixtures against the REAL DeepSeek API N times
 * (default 5, configurable via argv) and exits non-zero if any run disagrees
 * with the fixture's mustBeRelevant flag.
 *
 * Usage: npx tsx scripts/spot-check-false-positives.ts [N]
 */

interface SpotCheckFixture {
  label: string;
  mustBeRelevant: boolean;
  articleId: number;
  title: string;
  summary: string;
}

interface SpotCheckRun {
  fixtureLabel: string;
  runNumber: number;
  relevant: boolean;
  score: number;
  reason: string;
}

const DEFAULT_RUNS: number = 5;
const TOPIC_PHRASE: string = "sectorul ciocana";

const FIXTURES: SpotCheckFixture[] = [
  {
    label: "a (article 967, US cars bill)",
    mustBeRelevant: false,
    articleId: 967,
    title: "SUA interzic automobilele chinezești: Sub această măsură a căzut și Mercedes",
    summary:
      "Comitetul Senatului SUA pentru comerț a aprobat un proiect de lege care, practic, închide piața americană pentru producătorii auto chinezi.",
  },
  {
    label: "b (article 4002, smoke over Ciocana district)",
    mustBeRelevant: true,
    articleId: 4002,
    title: "(foto/video) Fum dens deasupra sectorului Ciocana: Nori negri se ridică spre cer",
    summary:
      "Nori denși de fum ridicându-se deasupra sectorului Ciocana al capitalei au fost observați astăzi. Mai mulți martori oculari au distribuit imagini foto și video pe rețele.",
  },
  {
    label: "c (article 1, Vinicius Junior surgery)",
    mustBeRelevant: false,
    articleId: 1,
    title: "Starul lui Real Madrid este de nerecunoscut: Vinicius Junior și-a făcut o operație estetică la 26 de ani",
    summary:
      "Fotbalistul Vinicius Junior se află în vacanță, după ce a jucat pentru Brazilia la Cupa Mondială 2026, turneu final la care s-a oprit în optimi. Marți, internetul s-a umplut de fotografii cu noul look al lui Vinicius Junior, care a decis să își facă o operație estetică la bărbie, scrie digisport.ro.",
  },
  // Sent to a real chat on 2026-08-07 at score 0.8. "sectorul" here is a stretch of
  // road, and the model invented "a major road located in the Ciocana sector of
  // Chișinău" to justify the match — Șoseaua Muncești is in Botanica, and the
  // article never names a district at all. Hardest of the four: same word, same
  // language, and the false link is asserted as fact rather than merely inferred.
  {
    label: "d (article 1628, road-segment 'sector')",
    mustBeRelevant: false,
    articleId: 1628,
    title: "Un nou tronson de pe Șoseaua Muncești a intrat în reabilitare",
    summary:
      "Un nou tronson al Șoselei Muncești a intrat în proces de reabilitare. Primăria municipiului Chișinău anunță că au început lucrările de frezare a carosabilului pe sectorul cuprins între strada Arca Moldovei și strada Băcioii Noi, etapă care precede modernizarea integrală a suprafeței asfaltice. Pe acest tronson, cu o suprafață de aproximativ 23 de mii de …",
  },
];

function parseRunCount(argv: string[]): number {
  const raw: string | undefined = argv[2];

  if (raw === undefined) return DEFAULT_RUNS;

  const parsed: number = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid run count "${raw}", expected a positive integer`);
  }

  return parsed;
}

async function main(): Promise<void> {
  const runCount: number = parseRunCount(process.argv);
  const results: SpotCheckRun[] = [];
  let failures: number = 0;

  console.log(
    `Spot-checking ${FIXTURES.length} fixtures against "${TOPIC_PHRASE}" (${runCount} run(s) each, model ${config.DEEPSEEK_MODEL_ID})`,
  );

  for (const fixture of FIXTURES) {
    for (let runNumber: number = 1; runNumber <= runCount; runNumber += 1) {
      const matches: ClassifyResult[] | null = await classifyArticle(
        fixture.articleId,
        fixture.title,
        fixture.summary,
        [{ id: 1, phrase: TOPIC_PHRASE }],
      );
      const match: ClassifyResult | undefined = matches?.[0];
      const relevant: boolean = match?.relevant ?? false;
      const score: number = match?.score ?? 0;
      const reason: string = match?.reason ?? "";
      const passed: boolean = fixture.mustBeRelevant ? relevant : !relevant;

      results.push({ fixtureLabel: fixture.label, runNumber, relevant, score, reason });

      console.log(
        `[${fixture.label}] run ${runNumber}: relevant=${relevant} score=${score} reason="${reason}" ${passed ? "PASS" : "FAIL"}`,
      );

      if (!passed) failures += 1;
    }
  }

  const relevantRuns: number = results.filter((run) => run.relevant).length;

  console.log("");
  console.log(`Aggregate: ${results.length} run(s), ${relevantRuns} relevant, ${failures} failure(s)`);

  if (failures > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
