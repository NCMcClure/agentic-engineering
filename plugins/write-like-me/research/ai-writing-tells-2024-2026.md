# Tells of AI/LLM-Written English (2024–2026)

*A cited research report on the lexical, punctuation, structural, and statistical signals that distinguish LLM-generated English text — and how quickly those signals are decaying.*

**Compiled:** 2026-07-06
**Method:** Fan-out web research across 6 angles → 28 sources fetched → 126 claims extracted → 25 top claims put through 3-vote adversarial verification (≥2/3 refutations kill a claim) → synthesis. 23 claims confirmed, 2 refuted. Sources are graded **primary** (peer-reviewed papers, model-maker docs), **secondary** (mainstream journalism), or **blog** (practitioner write-ups).

---

## TL;DR

- **The strongest, best-evidenced tell is lexical:** an abrupt, measurable post-ChatGPT surge in "excess" *style* words — **delve/delving, showcasing, underscores, boasts, intricate, crucial, landscape, potential**. What makes this a *fingerprint* rather than a topic effect is the part of speech: the LLM-driven excess is ~66% verbs and ~14% adjectives, whereas genuine topic-driven vocabulary spikes (e.g., COVID) are ~79% nouns. [primary]
- **These lexical tells are actively decaying.** Once "delve" was publicly outed as an AI marker in early 2024, its frequency *dropped*; other favored words like "significant" kept rising. Humans and models are co-evolving, so any specific word list has a short shelf life. [primary]
- **The single most popular pop-culture tell — the em-dash — is unreliable** and is being deliberately removed. Em-dash rates vary hugely by model, and OpenAI said in Nov 2025 it had trained ChatGPT to drop em-dashes on request. [secondary]
- **Detection has four families:** watermarking, statistics-based zero-shot detectors, neural classifiers, and human-assisted methods. The best zero-shot statistical detectors (Binoculars, Fast-DetectGPT, DetectGPT) post strong benchmark numbers but degrade on short, edited, paraphrased, or non-English text. [primary]
- **Population-level estimation beats per-document verdicts.** Corpus-scale statistical methods reliably show LLM adoption (≥13.5% of 2024 biomedical abstracts; up to 17.5% of CS paper sentences), but per-document AI detectors are not "operationally reliable" — a 2026 NIST evaluation found 62–84% accuracy across 14 commercial tools, and detectors are biased against non-native English writers. [primary/secondary]

---

## 1. Lexical & Stylistic Tells

### 1.1 The "excess vocabulary" fingerprint *(high confidence, primary)*

The flagship evidence comes from **Kobak et al., "Delving into LLM-assisted writing in biomedical publications through excess vocabulary"** (*Science Advances* 2025; preprint arXiv:2406.07016), which analyzed **15M+ PubMed abstracts (2010–2024)**. Using an "excess word usage" metric (modeled on excess-mortality math), they found an **abrupt post-ChatGPT jump in style-word frequency that exceeded even COVID's impact on vocabulary**.

Named markers include: **delves/delving, showcasing, underscores, potential, crucial, landscape, boasts.**

A second, independent study — **Juzek & Ward, "Why Does ChatGPT 'Delve' So Much?"** (arXiv:2412.11385, COLING 2025) — isolates **21 focal overrepresented words** (including **delve, intricate, underscore**) that rose sharply in scientific abstracts.

> **Sources:** [Kobak et al., *Science Advances* 2025](https://www.science.org/doi/10.1126/sciadv.adt3813) · [Juzek & Ward, arXiv:2412.11385](https://arxiv.org/abs/2412.11385)

### 1.2 Why it's a fingerprint, not a topic effect *(high confidence, primary)*

The key methodological insight: separate **content words** (topic-driven nouns that spike for real semantic reasons) from **style words** (verbs/adjectives whose frequency jumped *only* after LLMs). Kobak et al. found:

| Excess-vocabulary event | Composition |
|---|---|
| COVID-era (2020–2022) | ~79% **nouns** (content words) |
| 2024 LLM-era | of 379 excess style words: **~66% verbs, ~14% adjectives** |

The paper frames these style words as "fingerprints of machine-assisted composition rather than conveying substantive scientific information." Verb/adjective excess with no matching topic shift is the signal.

> **Source:** [Kobak et al., *Science Advances* 2025](https://www.science.org/doi/10.1126/sciadv.adt3813)

### 1.3 Practitioner word lists *(moderate confidence, blog/secondary)*

Practitioner catalogs consistently name a broader set. These are useful as heuristics but are noisier than the peer-reviewed style-word finding, and (see §4) fastest to decay:

- **Single words:** delve, tapestry, vibrant, realm, embark, intricate, pivotal, crucial, testament, boasts, showcase, foster, garner, underscore, comprehensive, landscape, beacon, harness, illuminate, palpable, notably, arguably, moreover.
- **Phrases:** "dive into," "it's important to note," "stands as / serves as (a testament)," sentence-initial "Additionally,".
- **"Aidiolects" — model-specific fingerprints:** some models favor *intricate* / *underscore*; others prefer *palpable*. Vocabulary preferences differ by model, which is itself a (weak) attribution signal.

> **Sources:** [Plus AI — most overused ChatGPT words](https://plusai.com/blog/the-most-overused-chatgpt-words) [blog] · [How Many Words — ChatGPT writing style tells](https://howmanywords.app/blog/chatgpt-writing-style-tells) [blog] · [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) [secondary]

### 1.4 Probable cause: RLHF *(high confidence on "plausible", primary)*

Juzek & Ward find the overrepresentation is "consistent with **RLHF** [reinforcement learning from human feedback] playing a role" but call the evidence **"inconclusive."**

⚠️ **Verification note:** A stronger companion claim — that model *architecture, algorithm, and training data were definitively ruled out* as causes — was **refuted (0–3)** in adversarial verification. Treat those as "no evidence found," **not** "excluded."

> **Source:** [Juzek & Ward, arXiv:2412.11385](https://arxiv.org/abs/2412.11385)

---

## 2. Punctuation Tells (Especially the Em-Dash)

### 2.1 The em-dash is a weak and eroding tell *(high confidence, secondary)*

The em-dash ("—") became the most famous pop-culture "ChatGPT tell," appearing in essays, emails, LinkedIn posts, and ad copy. **The evidence says it is unreliable:**

- **Rates vary wildly by model.** In one hands-on test: ChatGPT used 8 em-dashes in 573 words and Copilot 8 in 466, but **Claude used only 2 in 948 words and Gemini 0 in 499.** A single-model habit, not a universal AI signature.
- **OpenAI itself calls it unstable.** A member of OpenAI's model-behavior team said ChatGPT's em-dash preference is "not a hard-and-fast rule" and that its style constantly shifts with user feedback.
- **It's being actively removed.** In Nov 2025, Sam Altman said ChatGPT would stop using em-dashes when prompted; TechCrunch reported OpenAI had "fixed" the em-dash behavior. This directly degrades the tell going forward.

**Bottom line:** em-dash presence is at best a faint prior, not evidence. Other punctuation cues cited in practitioner guides — **curly/"smart" quotes, over-regular comma usage, "not X, but Y" constructions rendered with dashes** — carry the same caveat.

> **Sources:** [Washington Post — the em-dash isn't a reliable tell (2025-04)](https://www.washingtonpost.com/technology/2025/04/09/ai-em-dash-writing-punctuation-chatgpt/) [secondary] · [TechCrunch — OpenAI says it fixed the em-dash problem (2025-11)](https://techcrunch.com/2025/11/14/openai-says-its-fixed-chatgpts-em-dash-problem/) [secondary] · [PlagiarismToday — em-dashes and spotting AI writing](https://www.plagiarismtoday.com/2025/06/26/em-dashes-hyphens-and-spotting-ai-writing/) [blog]

---

## 3. Structural & Rhetorical Tells

⚠️ **Confidence caveat:** These are the *least* rigorously verified part of the literature. The strongest catalog is a community-maintained field guide (Wikipedia's "Signs of AI writing"), backed by practitioner blogs — not peer-reviewed corpus studies. Treat them as pattern heuristics, not statistical proofs.

### 3.1 The documented patterns *(moderate confidence, secondary/blog)*

- **Rule of three / tricolon overuse.** LLMs disproportionately produce three-item structures ("The thing is x, y, and z") in long-form output.
- **Negative parallelisms:** "not only X but Y," "it's not X, it's Y," "X rather than Y."
- **Weasel-word hedging:** "Observers have cited…," "Some argue…," "It's important to note that…."
- **Empty summary sentences** that "pretend to conclude a thought" without adding content.
- **Flat, uniform sentence rhythm** and uniform paragraph length (low *burstiness* — see §5).
- **Overuse of bullet points and outlines** where prose is expected.
- **Dangling demonstratives:** "This highlights…," "These findings…" with no clear referent.

> **Sources:** [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) [secondary] · [GPTZero — the rule of three](https://gptzero.me/news/the-rule-of-three/) [blog] · [Sh-Reya — AI writing patterns](https://www.sh-reya.com/blog/ai-writing/) [blog] · [The Augmented Educator — ten telltale signs](https://www.theaugmentededucator.com/p/the-ten-telltale-signs-of-ai-generated) [blog]

---

## 4. How the Tells Are Shifting (The Coevolution Problem)

This is the **dominant caveat** for every lexical/stylistic tell above.

### 4.1 Publicized markers decay — but not uniformly *(high confidence, primary)*

**Geng & Trotta, "Human-LLM Coevolution"** (arXiv:2502.09606, Feb 2025) documents:

- **"delve" dropped markedly** in arXiv abstracts soon after it was publicly flagged as an AI tell in early 2024.
- **"significant" kept rising** despite similar scrutiny — decay is word-specific, not universal.
- Authors "adapted their use of LLMs by selecting outputs or applying modifications," which "introduces additional challenges to detection."

**Implication:** any fixed word list is a depreciating asset. The *method* (excess style-word detection at the corpus level) survives; the *specific words* rotate. Population-level signals age more gracefully than per-document word-spotting.

> **Source:** [Geng & Trotta, arXiv:2502.09606](https://arxiv.org/abs/2502.09606)

---

## 5. Statistical Detection Methods

Detection is canonically framed as **binary classification** (LLM-produced vs. human), organized by a peer-reviewed *Computational Linguistics* survey (2025) into four families: **watermarking, statistics-based detectors, neural-based detectors, and human-assisted methods.** [[survey](https://aclanthology.org/2025.cl-1.8/), primary]

### 5.1 DetectGPT — the foundational zero-shot detector *(high confidence, primary)*

**Mitchell et al. (ICML 2023, arXiv:2301.11305).** Core hypothesis: **machine-sampled text tends to occupy negative-curvature regions of the model's log-probability function.** It needs **no trained classifier and no labeled dataset** — only the target model's log-probs plus random perturbations from a generic model (e.g., T5). Result: raised GPT-NeoX (20B) fake-news detection to **0.95 AUROC** vs. 0.81 for the best prior zero-shot baseline.

> **Sources:** [Mitchell et al., arXiv:2301.11305](https://arxiv.org/abs/2301.11305) · [PMLR v202 proceedings](https://proceedings.mlr.press/v202/mitchell23a.html)

### 5.2 Fast-DetectGPT — faster and more accurate *(high confidence, primary)*

**Bao et al. (EACL 2024, arXiv:2310.05130)** replaces DetectGPT's perturbation step with a **sampling** step and introduces **conditional probability curvature** (≈3 for machine text, ≈0 for human). Reported: **~75% relative accuracy improvement** over DetectGPT in both white-box and black-box settings, and **~340× faster.**

> **Source:** [Bao et al., arXiv:2310.05130](https://arxiv.org/abs/2310.05130)

### 5.3 Binoculars — SOTA zero-shot, no training on machine text *(high confidence, primary)*

**Hans et al. (ICML 2024, arXiv:2401.12070)** scores text via a **ratio of perplexity to cross-perplexity** between two closely related pre-trained models (e.g., Falcon-7B and Falcon-7B-instruct). Reported: **>90% detection of ChatGPT-generated samples at a 0.01% false-positive rate**, despite never being trained on ChatGPT data. Known to degrade on very short, memorized, or non-English text.

> **Source:** [Hans et al., arXiv:2401.12070](https://arxiv.org/abs/2401.12070)

### 5.4 Perplexity & burstiness (the classic signals underneath)

The intuition threading through all of the above: LLM text tends toward **lower perplexity** (it's more predictable to a language model) and **lower burstiness** (less variation in sentence length/complexity) than human writing. These are the features tools like GPTZero surface; DetectGPT/Fast-DetectGPT/Binoculars are more robust, curvature- or ratio-based refinements of the same idea.

### 5.5 Corpus-level estimation > per-document classification *(high confidence, primary)*

**Liang et al. (Stanford, arXiv:2404.01268)** analyzed 950,965 papers (Jan 2020–Feb 2024) and argue their **maximum-likelihood distributional estimation "operates on the corpus level and is more robust than inference on individual instances."** This is the methodological through-line of the whole field: you can measure *how much* AI writing is in a population far more reliably than you can convict a *single* document.

> **Source:** [Liang et al., arXiv:2404.01268](https://arxiv.org/abs/2404.01268)

---

## 6. Watermarking (Provenance at Generation Time)

Unlike detectors that infer after the fact, watermarking embeds a signal **while the text is generated.**

### 6.1 SynthID-Text *(high confidence, primary)*

**Dathathri et al., "Scalable watermarking for identifying large language model outputs"** (*Nature*, Oct 2024). SynthID-Text modulates token probabilities at generation using **Tournament sampling** keyed by a pseudorandom *g*-function over preceding tokens — embedding a detectable statistical pattern **in the model's word choices**, without altering the visible text afterward and, per Google, without degrading quality, accuracy, or speed. Its presence is detectable even via black-box queries.

> **Sources:** [Dathathri et al., *Nature* 2024](https://www.nature.com/articles/s41586-024-08025-4) · [Google DeepMind — SynthID](https://deepmind.google/discover/blog/watermarking-ai-generated-text-and-video-with-synthid/) · [Google AI SynthID docs](https://ai.google.dev/responsible/docs/safeguards/synthid)

### 6.2 Red-Green watermarking (the precursor)

**Kirchenbauer et al. (arXiv:2301.10226)** established the "green-list" approach: before each token, select a randomized set of "green" tokens and **softly promote** them during sampling; detection later needs no model access, only the key. SynthID-Text is a production refinement of this lineage.

> **Source:** [Kirchenbauer et al., arXiv:2301.10226](https://arxiv.org/abs/2301.10226)

### 6.3 CurveMark — combining passive + active signals *(high confidence on framework, primary)*

**Zhang et al. (*Entropy*/MDPI 2025)** present **CurveMark**, a dual-channel framework uniting **probability-curvature analysis** (a DetectGPT-style passive detector) with **dynamic semantic watermarking** (an active generation-time channel), under information-theoretic principles.

⚠️ **Verification note:** the framework description is confirmed, but CurveMark's specific **95.4% cross-dataset accuracy figure was refuted (1–2)** and should not be cited.

> **Source:** [Zhang et al., *Entropy* 27(8):784](https://www.mdpi.com/1099-4300/27/8/784)

---

## 7. Reliability: Why You Cannot Convict a Single Document

- **NIST (2026):** Evaluated **14 commercial AI-text detectors against 50,000 samples** and concluded **none achieved "operationally reliable" accuracy**; overall accuracy ranged **62%–84%.** [secondary — [editorsweblog](https://editorsweblog.org/2026/04/14/nist-verdict-ai-text-detectors-unreliable-federal-standard)]
- **Bias against non-native writers:** A Stanford HAI study found detectors flagged **61.22% of TOEFL essays by non-native English speakers as AI-generated** — a systematic false-positive bias against constrained vocabulary. [blog — [Eyesift](https://www.eyesift.com/blog/ai-detection-false-positives/), citing Stanford HAI]
- **Adversarial fragility:** The strong detector benchmarks (Binoculars, Fast-DetectGPT, DetectGPT) degrade under paraphrasing/editing attacks, on short texts, and on memorized or non-English content — by the authors' own accounts.

**Practical upshot:** use tells and detectors to *raise suspicion at scale*, never to *convict an individual*. A high-stakes accusation resting on em-dashes, a "delve," or a single detector score is not defensible.

---

## 8. Scale of Adoption (Context)

- **≥13.5% of 2024 PubMed biomedical abstracts** show LLM processing (a *lower bound*; up to **40% in some subcorpora** by discipline/country/journal). [[Kobak et al.](https://www.science.org/doi/10.1126/sciadv.adt3813)]
- **Field-dependent:** by early 2024, up to **17.5% of Computer Science paper sentences** showed LLM modification vs. up to **6.3%** in Mathematics and Nature-portfolio journals. [[Liang et al.](https://arxiv.org/abs/2404.01268)]

---

## 9. Caveats & Open Questions

**Caveats:**
1. **Time-sensitivity is the biggest one.** Lexical tells decay as authors and models adapt; any word list ages fast. Corpus-level style-word methods age better than per-document word-spotting.
2. **Domain skew.** The strongest evidence is from academic/scientific abstracts (PubMed, arXiv), *not* general-purpose or conversational English — markers and rates may differ elsewhere.
3. **Benchmark optimism.** Detector accuracy figures are authors' own results on their own eval sets and degrade in the wild.
4. **Two claims were refuted and excluded:** (a) that architecture/algorithm/training-data were "ruled out" as causes of overrepresentation (0–3); (b) CurveMark's 95.4% accuracy figure (1–2).
5. **Punctuation and structural tells are under-sourced** relative to lexical and statistical findings — they rest on journalism and community guides, not peer-reviewed corpus studies.

**Open questions:**
- What are the *empirically verified* punctuation/structural tells (em-dash rates, curly quotes, rule-of-three density, hedging frequency) for 2024–2026 text? Current evidence is largely anecdotal.
- How well do lexical and statistical detectors transfer beyond academic abstracts, and how much does human editing/paraphrasing degrade Binoculars and Fast-DetectGPT specifically?
- As frontier models (GPT-5-class, Claude, Gemini) reduce style-word overrepresentation, are excess-vocabulary methods losing sensitivity — and does watermarking become the only durable signal?
- How robust is SynthID-Text against paraphrasing, translation, and cross-model laundering at real-world scale?

---

## Sources

**Primary (peer-reviewed / model-maker):**
- Kobak et al., "Delving into LLM-assisted writing in biomedical publications through excess vocabulary," *Science Advances* 2025 (arXiv:2406.07016) — https://www.science.org/doi/10.1126/sciadv.adt3813
- Juzek & Ward, "Why Does ChatGPT 'Delve' So Much?," COLING 2025 — https://arxiv.org/abs/2412.11385
- Geng & Trotta, "Human-LLM Coevolution," 2025 — https://arxiv.org/abs/2502.09606
- Liang et al. (Stanford), "Mapping the Increasing Use of LLMs in Scientific Papers," 2024 — https://arxiv.org/abs/2404.01268
- "A Survey on LLM-Generated Text Detection," *Computational Linguistics* 2025 — https://aclanthology.org/2025.cl-1.8/
- Mitchell et al., "DetectGPT," ICML 2023 — https://arxiv.org/abs/2301.11305 · https://proceedings.mlr.press/v202/mitchell23a.html
- Bao et al., "Fast-DetectGPT," EACL 2024 — https://arxiv.org/abs/2310.05130
- Hans et al., "Binoculars," ICML 2024 — https://arxiv.org/abs/2401.12070
- Dathathri et al., "SynthID-Text," *Nature* 2024 — https://www.nature.com/articles/s41586-024-08025-4
- Kirchenbauer et al., "A Watermark for Large Language Models," 2023 — https://arxiv.org/abs/2301.10226
- Zhang et al., "CurveMark," *Entropy* 2025 — https://www.mdpi.com/1099-4300/27/8/784
- Google DeepMind / Google AI — SynthID — https://deepmind.google/discover/blog/watermarking-ai-generated-text-and-video-with-synthid/ · https://ai.google.dev/responsible/docs/safeguards/synthid

**Secondary (journalism):**
- Washington Post (2025-04) — em-dash reliability — https://www.washingtonpost.com/technology/2025/04/09/ai-em-dash-writing-punctuation-chatgpt/
- TechCrunch (2025-11) — OpenAI "fixes" em-dash — https://techcrunch.com/2025/11/14/openai-says-its-fixed-chatgpts-em-dash-problem/
- editorsweblog (2026-04) — NIST verdict on detectors — https://editorsweblog.org/2026/04/14/nist-verdict-ai-text-detectors-unreliable-federal-standard
- Wikipedia: Signs of AI writing — https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing

**Blog / practitioner:**
- Plus AI — most overused ChatGPT words — https://plusai.com/blog/the-most-overused-chatgpt-words
- How Many Words — ChatGPT writing style tells — https://howmanywords.app/blog/chatgpt-writing-style-tells
- PlagiarismToday — em-dashes and spotting AI — https://www.plagiarismtoday.com/2025/06/26/em-dashes-hyphens-and-spotting-ai-writing/
- GPTZero — the rule of three — https://gptzero.me/news/the-rule-of-three/
- Eyesift — AI detection false positives (cites Stanford HAI) — https://www.eyesift.com/blog/ai-detection-false-positives/

---

*Generated by the deep-research workflow: 6 search angles, 28 sources, 126 candidate claims, 25 adversarially verified (3-vote, ≥2/3 to kill). Confidence labels reflect source grade and verification vote; unverified/refuted material is flagged inline.*
