<script>
  let {
    open = false,
    article = null,
    content = null,
    loading = false,
    error = null,
    onclose = () => {},
    onretry = () => {},
    oncopy = () => {},
  } = $props();

  let copied = $state(false);

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
        <div class="content-text">
          <pre>{content.text}</pre>
        </div>
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
