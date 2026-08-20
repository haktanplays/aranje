# S-01 provenance — düzeltme

Faz 2G bölüm A gereği yapılan denetim. **S-01 artifact'leri değiştirilmedi**;
bu dosya önceki teslim raporundaki kanıtsız model ifadesini düzeltir.

## Sınıflandırma

    coding_agent_simulation

S-01, **aktif Opus 5 coding agent** tarafından provider çıktısı simüle
edilerek Copilot contract, apply ve validator zincirinin çalıştırıldığı bir
shadow rehearsal'dır. Gerçek Sonnet veya gerçek production-provider eval'i
**değildir**.

## Düzeltilen ifade

S-01 teslim raporunda şu cümle geçti:

> "**Sonnet 8 turda 1 şema hatası üretti** (explanation uzunluğu)."

Bu ifade yanlıştır. Sonnet hiç çağrılmadı. Doğrusu:

> Opus 5 coding agent, provider rolünde 8 tur boyunca elle üretilen JSON
> cevaplarında 1 şema hatası yaptı (`explanation` 400 karakter sınırını
> aştı). Bu, herhangi bir modelin gerçek başarım oranı hakkında **hiçbir
> şey söylemez**; yalnız contract zincirinin o hatayı yakaladığını gösterir.

S-01 raporundaki ilgili sorunun ("Sonnet kaç turda schema/validator hatası
üretti?") sorulabilir bir soru olması, cevabın Sonnet hakkında olduğu
anlamına gelmiyordu; bunu o zaman belirtmem gerekirdi.

## Denetim soruları ve kanıtları

| # | Soru | Cevap | Kanıt |
|---|---|---|---|
| 1 | `BLUEPRINT.md` kimin? | Opus 5 coding agent | Oturum transcript'inde `Bash` heredoc ile yazıldı; başka ajan yok |
| 2 | 8 turdaki attempt'leri kim üretti? | Opus 5 coding agent | 10 response dosyasının tamamı `Bash` + `python3 - <<'PY'` heredoc'larıyla, aynı asistan turlarında yazıldı |
| 3 | Ayrı bir Sonnet çağrısı yapıldı mı? | **Hayır** | Oturumda `Agent`/`Task`/`Workflow`/`SendMessage` çağrısı sayısı: **0** |
| 4 | Bir subagent Sonnet'e sabitlenmiş miydi? | **Hayır** | Hiç subagent yok (bkz. 3) |
| 5 | Provider/SDK çağrısı var mıydı? | **Hayır** | `package.json` ve `package-lock.json` içinde `anthropic\|openai\|@ai-sdk\|langchain` eşleşmesi yok; `src/lib/ai/` yalnız `adapter.ts` + `fake-adapter.ts` içeriyor; `runtime.ts` adapter kayıtlı değilse hata atıyor |
| 6 | Çıktılar aktif coding agent tarafından mı simüle edildi? | **Evet** | Bkz. 1–5 |
| 7 | Model kimliğini doğrulayan runtime metadata var mı? | **Evet** | `get_session`: `session_context.model = "claude-opus-5"`, `external_metadata.last_served_model = "claude-opus-5"` |

Oturumda kullanılan tool'ların tamamı: `Bash` (1124), `TaskUpdate` (91),
`TaskCreate` (50), `SendUserFile` (22), `Read` (21), `Skill` (5),
`ToolSearch` (5), `AskUserQuestion` (2). Ağ üzerinden model çağıran hiçbir
tool yok.

`eval/` altında hiçbir ağ çağrısı yok; tek `fetch` kullanımı
`render-entry.ts` içindeki yerel `/samples/` sayacıdır.

## S-01'in gerçekten kanıtladığı ve kanıtlamadığı şeyler

**Kanıtladığı:**

- `buildPrompt → parseArrangePatch → validateArrangeOutput → patchSize →
  applyPatch → checkLockedSurface → runValidators` zinciri 8 ardışık turda
  uçtan uca çalışıyor.
- Locked surface, patch size ve strict schema gerçekten reddediyor.
- Contract'ta üç boşluk var (output şeması adapter'a taşınmıyor, veri
  katmanı tek section taşıyor, `asData` diagnostic'i bozuyor).
- Bir production defect'i (expression fallback diagnostic kaybı) mevcut.

**Kanıtlamadığı:**

- Herhangi bir modelin bu contract'ta ne kadar başarılı olduğu.
- Prompt'un yeterli olup olmadığı. Şema alan adlarını repo'dan bildiğim
  için attempt 0'da doğru üretebildim; gerçek bir provider bunu göremez.
  S-01 raporunda bu zaten belirtilmişti ve doğruluğunu koruyor.
- Provider latency, maliyet veya token davranışı hakkında hiçbir şey.
