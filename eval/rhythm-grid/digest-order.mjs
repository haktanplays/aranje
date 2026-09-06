// Faithful shape: each caller awaits THREE digests in sequence before it
// reserves, exactly as withStore() does. Started A-then-B. Who finishes first?
const enc = new TextEncoder();
const hash = (v) => crypto.subtle.digest("SHA-256", enc.encode(v));
const big = (n) => "x".repeat(n);

async function caller(tag, payload) {
  await hash(tag + "-subject");
  await hash(tag + "-idem");
  await hash(tag + "-fingerprint" + payload);   // the request body: much bigger
  return tag;
}

const LOAD = Number(process.argv[2] ?? 0);
let inversions = 0, trials = 0;
for (let round = 0; round < 300; round += 1) {
  const noise = Array.from({ length: LOAD }, (_u, i) => hash(big(64_000) + i));
  const order = [];
  const a = caller("a", big(20_000)).then((t) => order.push(t));
  const b = caller("b", big(20_000)).then((t) => order.push(t));
  await Promise.all([a, b, ...noise]);
  trials += 1;
  if (order[0] !== "a") inversions += 1;
}
console.log(JSON.stringify({ load: LOAD, trials, inversions, rate: inversions / trials }));
