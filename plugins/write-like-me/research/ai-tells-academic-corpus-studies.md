# AI/LLM Writing Tells — Academic Corpus & Word-Frequency Studies (2024–2026)

Angle: peer-reviewed and preprint quantitative research measuring vocabulary and
frequency shifts in scientific/English corpora attributable to LLMs.

## Key takeaways

- The dominant detection signal in the academic literature is **excess vocabulary**:
  abrupt, model-driven jumps in the frequency of specific "style words"
  (e.g., *delve, intricate, underscore, boasts, significant, pivotal, realm,
  tapestry, showcasing*) after ChatGPT's late-2022 release.
- The largest study (Kobak et al., *Science Advances* 2025) estimates **at least
  13.5% of 2024 PubMed abstracts** were LLM-processed, with subcorpora up to ~40%.
- Tells are **not static**: once *delve* was publicly flagged as an AI marker in
  early 2024, its academic frequency dropped, while other favored words (e.g.
  *significant*) kept rising — evidence of human–LLM "coevolution."
- Excess-vocabulary methods borrow the COVID-era excess-mortality approach: compare
  observed 2024 frequencies against a counterfactual projected from pre-LLM trends.

## Sources

### 1. Kobak, González-Márquez, Horvát, Lause — "Delving into LLM-assisted writing in biomedical publications through excess vocabulary"
- Science Advances, July 2025 (preprint arXiv:2406.07016, June 2024).
- https://www.science.org/doi/10.1126/sciadv.adt3813 · https://arxiv.org/abs/2406.07016
- Analyzed 15M+ PubMed abstracts (2010–2024). Introduced the **excess word usage**
  metric (analogous to excess mortality). Estimated ≥13.5% of 2024 abstracts were
  LLM-processed. Found abrupt post-LLM spikes in style/function words, varying by
  discipline, country, and journal; effect size exceeds the COVID vocabulary shock.
- Flagship, most-cited quantitative benchmark for corpus-level LLM detection.

### 2. Juzek & Ward — "Why Does ChatGPT 'Delve' So Much? Exploring the Sources of Lexical Overrepresentation in Large Language Models"
- 2024 (COLING-associated; arXiv:2412.11385).
- https://arxiv.org/abs/2412.11385
- Identified **21 focal words** disproportionately overrepresented in scientific
  abstracts (delve, intricate, underscore, etc.). Tested whether the cause is
  architecture, training data, or algorithms; found the best evidence points to
  **RLHF** amplifying certain words. Provides a formal, transferable method for
  measuring lexical overrepresentation.
- Directly explains *why* the word-frequency tells exist (RLHF, not just training data).

### 3. Geng & Trotta — "Human-LLM Coevolution: Evidence from Academic Writing"
- 2025 (ACL 2025 Findings; arXiv:2502.09606).
- https://arxiv.org/abs/2502.09606 · https://aclanthology.org/2025.findings-acl.657/
- Tracked arXiv abstracts and showed the frequency of *delve* and similar flagged
  terms **dropped soon after being publicly called out in early 2024**, while other
  LLM-favored words (e.g. *significant*) kept climbing. Argues detection must track
  moving targets as authors selectively edit AI output.
- Best evidence that tells shift/decay over time — critical for any current detector.

### 4. Juzek & Ward (earlier) / related — "Why Does ChatGPT 'Delve' So Much?" large arXiv analysis
- 2024. https://www.semanticscholar.org/paper/Why-Does-ChatGPT-%22Delve%22-So-Much
- Companion large-scale analysis of ~823,798 arXiv abstracts; correlates elevated
  LLM-marker usage with **non-native English speakers** more frequently using LLMs
  for composition (consistent with Liang et al. findings on peer reviews).
- Adds demographic/geographic dimension to who triggers the frequency signals.

### 5. Liang et al. — "Mapping the Increasing Use of LLMs in Scientific Papers" / peer-review corpus studies
- 2024 (arXiv:2404.01268 and companion ICLR/EMNLP review studies).
- https://arxiv.org/abs/2404.01268
- Estimated the fraction of LLM-modified sentences in scientific papers and AI
  conference peer reviews (up to ~17% of review text) using a distributional
  word-frequency (maximum-likelihood) framework rather than per-document classifiers.
- Methodological anchor: population-level estimation of AI adjectives/verbs.

### 6. "How much are LLMs changing the language of academic papers/spoken language?"
- 2024 corpus-tracking work (Semantic Scholar; related to Geng & Trotta line).
- https://www.semanticscholar.org/paper/How-much-are-LLMs-changing-the-language-of-academic
- Tracks ~12 LLM-associated terms across six scholarly databases (2015–2024),
  quantifying the linguistic shift and extending analysis toward spoken/transcribed
  English, showing spillover beyond written academic text.
- Useful for the "how tells shifted as models improved / spread" angle.
