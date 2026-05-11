<script>
  let {
    open = false,
    article = null,
    content = null,
    loading = false,
    error = null,
    summary = null,
    summarizing = false,
    summaryError = null,
    onclose = () => {},
    onretry = () => {},
    onsummarize = () => {},
    oncopy = () => {},
  } = $props();

  let copied = $state(false);
  let showFullText = $state(false);

  function handleCopy() {
    oncopy();
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2000);
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && open) {
      onclose();
    }
  }

  function renderMarkdown(text) {
    if (!text) return '';
    // Escape HTML first (defense-in-depth — LLM output shouldn't contain markup)
    let s = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Convert **bold** to <strong>
    s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');

    // Replace markdown bullets at line start with a bullet character
    s = s.replace(/^[ \t]*[*\-][ \t]+/gm, '• ');

    return s;
  }

  function getTypeLabel(type) {
    switch (type) {
      case 'youtube':
        return 'YouTube-video';
      case 'podcast':
        return 'Podcast';
      case 'bluesky':
        return 'Bluesky-innlegg';
      default:
        return 'Artikkel';
    }
  }

  // Reset showFullText when panel content changes
  $effect(() => {
    if (content) {
      showFullText = false;
    }
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div class="panel-overlay" onclick={onclose} role="button" tabindex="-1"></div>
  <aside class="side-panel">
    <header class="panel-header">
      <h2>{article?.title || 'Innhold'}</h2>
      <button class="close-btn" onclick={onclose} aria-label="Lukk">×</button>
    </header>

    <div class="panel-content">
      {#if loading}
        <div class="panel-loading">
          <div class="spinner"></div>
          <p>Henter innhold...</p>
        </div>
      {:else if error}
        <div class="panel-error">
          <p class="error-message">{error}</p>
          <button class="retry-btn" onclick={onretry}>Prøv igjen</button>
          {#if article?.link}
            <p class="fallback-text">
              {#if article.link.includes('youtube.com') || article.link.includes('youtu.be')}
                <a href={article.link} target="_blank" rel="noopener noreferrer">Åpne videoen på YouTube</a> og klikk "Show transcript" under videoen for å kopiere transkripsjonen.
              {:else}
                Eller <a href={article.link} target="_blank" rel="noopener noreferrer">åpne artikkelen direkte</a>
              {/if}
            </p>
          {/if}
        </div>
      {:else if content}
        <div class="content-meta">
          <span class="content-type">{getTypeLabel(content.type)}</span>
          <span class="content-source">{article?.source}</span>
        </div>

        {#if summarizing}
          <div class="summary-section">
            <div class="summary-loading">
              <div class="spinner small"></div>
              <span>Oppsummerer...</span>
            </div>
          </div>
        {:else if summary}
          <div class="summary-section">
            <div class="summary-header">
              <h3 class="summary-heading">{showFullText ? 'Full tekst' : 'Oppsummering'}</h3>
              <button class="toggle-btn" onclick={() => showFullText = !showFullText}>
                {showFullText ? 'Vis oppsummering' : 'Vis full tekst'}
              </button>
            </div>
            {#if showFullText}
              <div class="content-text inline">
                <pre>{content.text}</pre>
              </div>
            {:else}
              <div class="summary-text">{@html renderMarkdown(summary)}</div>
            {/if}
          </div>
        {:else if summaryError}
          <div class="summary-section">
            <p class="summary-error">{summaryError}</p>
            <button class="retry-summary-btn" onclick={onsummarize}>Prøv oppsummering igjen</button>
          </div>
        {/if}

        {#if !summary}
          <div class="content-text">
            <pre>{content.text}</pre>
          </div>
        {/if}
      {:else}
        <p class="panel-empty">Ingen innhold å vise</p>
      {/if}
    </div>

    {#if content?.text && !loading && !error}
      <footer class="panel-footer">
        <button class="copy-btn" onclick={handleCopy}>
          {copied ? '✓ Kopiert!' : 'Kopier til utklippstavle'}
        </button>
      </footer>
    {/if}
  </aside>
{/if}

<style>
  .summary-section {
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: var(--bg);
    border-radius: 8px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
  }

  .summary-heading {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--accent-hover);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .summary-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .summary-text {
    font-size: 0.9rem;
    line-height: 1.6;
    color: var(--text);
    white-space: pre-wrap;
  }

  .summary-loading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .spinner.small {
    width: 16px;
    height: 16px;
    border-width: 2px;
  }

  .summary-error {
    color: #f87171;
    font-size: 0.85rem;
    margin: 0;
  }

  .toggle-btn {
    flex-shrink: 0;
    padding: 0.35rem 0.75rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    cursor: pointer;
    font-size: 0.8rem;
  }

  .toggle-btn:hover {
    background: var(--bg-hover);
  }

  .retry-summary-btn {
    margin-top: 0.75rem;
    padding: 0.35rem 0.75rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: #fca5a5;
    cursor: pointer;
    font-size: 0.8rem;
  }

  .retry-summary-btn:hover {
    background: var(--bg-hover);
  }

  .content-text.inline {
    margin-top: 0;
    padding: 0;
    background: transparent;
    border: 0;
  }
</style>
