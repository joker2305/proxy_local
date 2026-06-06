/**
 * Import Chinese futures market data into Qdrant (RAG) and PostgreSQL (semantic store).
 * Usage: npx tsx scripts/import-futures.ts
 */
import { futuresContracts } from './futures-data';

const API_BASE = 'http://127.0.0.1:3456';
const API_KEY = 'local-dev-key';

const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY,
};

async function main() {
  console.log(`\n=== Importing ${futuresContracts.length} futures contracts ===\n`);

  let ragSuccess = 0;
  let semanticSuccess = 0;

  for (const contract of futuresContracts) {
    const tag = `[${contract.exchange}_${contract.product}] ${contract.name}`;

    // Import to RAG (Qdrant)
    try {
      const ragRes = await fetch(`${API_BASE}/api/rag/ingest`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          content: contract.content,
          source: contract.source,
          tags: ['futures', contract.exchange.toLowerCase(), contract.product.toLowerCase(), contract.assetClass],
        }),
      });
      const ragData = await ragRes.json() as any;
      if (ragData.success) {
        ragSuccess++;
        console.log(`  ✅ RAG: ${tag} (${ragData.chunks} chunks)`);
      } else {
        console.log(`  ❌ RAG: ${tag} - ${JSON.stringify(ragData)}`);
      }
    } catch (e: any) {
      console.log(`  ❌ RAG: ${tag} - ${e.message}`);
    }

    // Import to Semantic Store (PostgreSQL)
    try {
      const semRes = await fetch(`${API_BASE}/api/semantic/upsert`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          scope: 'reference',
          topic: `futures_${contract.product}_contract`,
          content: contract.content,
          source: contract.exchange,
          metadata: {
            exchange: contract.exchange,
            product: contract.product,
            name: contract.name,
            assetClass: contract.assetClass,
            multiplier: contract.multiplier,
            tickSize: contract.tickSize,
            marginRate: contract.marginRate,
            tradingHours: contract.tradingHours,
            contractMonths: contract.contractMonths,
            settlement: contract.settlement,
          },
        }),
      });
      const semData = await semRes.json() as any;
      if (semData.success) {
        semanticSuccess++;
        console.log(`  ✅ Semantic: ${tag} (id=${semData.id})`);
      } else {
        console.log(`  ❌ Semantic: ${tag} - ${JSON.stringify(semData)}`);
      }
    } catch (e: any) {
      console.log(`  ❌ Semantic: ${tag} - ${e.message}`);
    }
  }

  console.log(`\n=== Import Summary ===`);
  console.log(`  RAG (Qdrant): ${ragSuccess}/${futuresContracts.length} contracts`);
  console.log(`  Semantic (PostgreSQL): ${semanticSuccess}/${futuresContracts.length} contracts`);

  // Verify RAG search quality
  console.log(`\n=== Search Quality Verification ===\n`);

  const queries = [
    '沪深300期货的保证金是多少',
    '黄金期货的交易时间',
    '铁矿石期货合约规格',
    '10年期国债期货',
    '豆粕期货夜盘时间',
  ];

  for (const query of queries) {
    // RAG search
    const ragRes = await fetch(`${API_BASE}/api/rag/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });
    const ragResults = await ragRes.json() as any[];

    // Semantic search
    const semRes = await fetch(`${API_BASE}/api/semantic/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, scope: 'reference', limit: 2 }),
    });
    const semData = await semRes.json() as any;

    console.log(`Query: "${query}"`);
    if (ragResults.length > 0) {
      console.log(`  RAG: ${ragResults[0].document.source} (score=${ragResults[0].score.toFixed(3)})`);
    } else {
      console.log(`  RAG: no results`);
    }
    if (semData.results?.length > 0) {
      console.log(`  Semantic: ${semData.results[0].source} (similarity=${semData.results[0].similarity?.toFixed(3)})`);
    } else {
      console.log(`  Semantic: no results`);
    }
    console.log();
  }
}

main().catch(console.error);
