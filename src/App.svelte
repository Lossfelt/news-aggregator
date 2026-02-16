<script>
  import { fetchAllFeeds } from './lib/feeds.js';
  import { parseFeed, sortByDate } from './lib/parser.js';
  import { getReadArticles, markAsRead, toggleRead, getLastVisit, updateLastVisit, syncFromServer, syncToServer, getSources, saveSources, addSource as storageAddSource, removeSource as storageRemoveSource, toggleSourceEnabled, getActiveSources } from './lib/storage.js';
  import SidePanel from './lib/SidePanel.svelte';

  let articles = $state([]);
  let readArticles = $state(getReadArticles());
  let loading = $state(true);
  let loadingStatus = $state('');
  let errors = $state([]);
  let filter = $state('all');
  let sourceFilter = $state(null);
  let lastVisit = $state(getLastVisit());
  let showMarkAsReadMenu = $state(false);
  let showSources = $state(false);
  let editingSources = $state(false);
  let newFeedName = $state('');
  let newFeedUrl = $state('');
  let sources = $state(getSources());

  // Side panel state
  let panelOpen = $state(false);
  let selectedArticle = $state(null);
  let extractedContent = $state(null);
  let extracting = $state(false);
  let extractError = $state(null);

  const articleCountBySource = $derived(() => {
    const counts = {};
    for (const article of articles) {
      counts[article.source] = (counts[article.source] || 0) + 1;
    }
    return counts;
  });

  const filteredArticles = $derived(() => {
    let result = articles;

    if (sourceFilter) {
      result = result.filter(a => a.source === sourceFilter);
    }

    if (filter === 'unread') {
      result = result.filter(a => !(a.id in readArticles));
    }

    return result;
  });

  const unreadCount = $derived(articles.filter(a => !(a.id in readArticles)).length);
  const newSinceLastVisit = $derived(
    lastVisit ? articles.filter(a => a.pubDate && a.pubDate.getTime() > lastVisit).length : 0
  );

  async function loadFeeds() {
    loading = true;
    loadingStatus = 'Henter feeds...';
    errors = [];
    articles = [];

    // Sync from server before reading local state
    await syncFromServer();
    sources = getSources();

    const activeSources = getActiveSources();
    const { results, errors: fetchErrors } = await fetchAllFeeds(activeSources, (name, success) => {
      loadingStatus = `${success ? '✓' : '✗'} ${name}`;
    });

    errors = fetchErrors;

    // Filter to last month only
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const allArticles = [];
    for (const { xml, source } of results) {
      const parsed = parseFeed(xml, source);
      const recent = parsed.filter(a => !a.pubDate || a.pubDate >= oneMonthAgo);
      allArticles.push(...recent);
    }

    articles = sortByDate(allArticles);
    readArticles = getReadArticles();
    loading = false;

    updateLastVisit();
  }

  function handleToggleRead(articleId) {
    toggleRead(articleId);
    readArticles = getReadArticles();
    syncToServer();
  }

  function markAllAsRead(timeFilter = 'all') {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let articlesToMark = articles;

    if (timeFilter === 'today') {
      articlesToMark = articles.filter(a => a.pubDate && a.pubDate >= oneDayAgo);
    } else if (timeFilter === 'week') {
      articlesToMark = articles.filter(a => a.pubDate && a.pubDate >= oneWeekAgo);
    }

    for (const article of articlesToMark) {
      if (!(article.id in readArticles)) {
        markAsRead(article.id);
      }
    }

    readArticles = getReadArticles();
    showMarkAsReadMenu = false;
    syncToServer();
  }

  function handleToggleSource(url) {
    sources = toggleSourceEnabled(url);
    syncToServer();
  }

  function handleRemoveSource(url, name) {
    if (!confirm(`Fjerne ${name}?`)) return;
    sources = storageRemoveSource(url);
    syncToServer();
  }

  function handleAddSource() {
    const name = newFeedName.trim();
    const url = newFeedUrl.trim();
    if (!name || !url) return;
    try {
      new URL(url);
    } catch {
      alert('Ugyldig URL');
      return;
    }
    sources = storageAddSource(name, url);
    newFeedName = '';
    newFeedUrl = '';
    syncToServer();
  }

  function formatDate(date) {
    if (!date) return '';
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return 'Akkurat nå';
    if (hours < 24) return `${hours}t siden`;
    if (days < 7) return `${days}d siden`;

    return date.toLocaleDateString('no-NO', {
      day: 'numeric',
      month: 'short',
    });
  }

  function isNewSinceLastVisit(article) {
    if (!lastVisit || !article.pubDate) return false;
    return article.pubDate.getTime() > lastVisit;
  }

  async function extractContent(article) {
    selectedArticle = article;
    extractedContent = null;
    extractError = null;
    extracting = true;
    panelOpen = true;

    try {
      const apiUrl = '/api/extract';
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: article.link,
          source: article.source,
          title: article.title,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        extractError = data.error || 'Ukjent feil ved henting av innhold';
        return;
      }

      if (!data.text) {
        extractError = data.error || 'Kunne ikke hente innhold fra denne kilden';
        return;
      }

      extractedContent = {
        type: data.type,
        text: data.text,
        title: data.title || article.title,
      };
    } catch (err) {
      extractError = `Nettverksfeil: ${err.message}`;
    } finally {
      extracting = false;
    }
  }

  function closePanel() {
    panelOpen = false;
    selectedArticle = null;
    extractedContent = null;
    extractError = null;
  }

  function retryExtract() {
    if (selectedArticle) {
      extractContent(selectedArticle);
    }
  }

  function copyToClipboard() {
    if (!extractedContent || !selectedArticle) return;

    const typeLabel = extractedContent.type === 'youtube' ? 'videoen'
      : extractedContent.type === 'podcast' ? 'podcasten'
      : extractedContent.type === 'bluesky' ? 'Bluesky-innlegget'
      : 'artikkelen';

    const prompt = `Oppsummer denne ${typeLabel} på norsk:

Tittel: ${selectedArticle.title}
Kilde: ${selectedArticle.source}
Lenke: ${selectedArticle.link}

${extractedContent.text}

Gi meg:
1. Kort oppsummering (2-3 setninger)
2. Hovedpunkter (3-5 kulepunkter)
3. Viktigste innsikter`;

    navigator.clipboard.writeText(prompt);
  }

  $effect(() => {
    loadFeeds();
  });

  $effect(() => {
    if (showMarkAsReadMenu) {
      const handleClickOutside = () => {
        showMarkAsReadMenu = false;
      };
      setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  });
</script>

<main>
  <header>
    <h1>Feeds</h1>
    <div class="stats">
      {#if !loading}
        <span class="stat">{articles.length} artikler</span>
        <span class="stat">{unreadCount} uleste</span>
        {#if newSinceLastVisit > 0}
          <span class="stat new">{newSinceLastVisit} nye</span>
        {/if}
      {/if}
    </div>
    <div class="header-actions">
      <div class="mark-read-dropdown">
        <button
          class="mark-read-btn"
          onclick={(e) => { e.stopPropagation(); showMarkAsReadMenu = !showMarkAsReadMenu; }}
          disabled={loading || unreadCount === 0}
        >
          Merk som lest ▾
        </button>
        {#if showMarkAsReadMenu}
          <div class="dropdown-menu">
            <button onclick={() => markAllAsRead('today')}>Fra i dag</button>
            <button onclick={() => markAllAsRead('week')}>Fra siste uke</button>
            <button onclick={() => markAllAsRead('all')}>Alle</button>
          </div>
        {/if}
      </div>
      <button class="refresh" onclick={loadFeeds} disabled={loading}>
        {loading ? '⟳' : '↻'} Oppdater
      </button>
    </div>
  </header>

  <nav class="filters">
    <button class:active={filter === 'all' && !sourceFilter} onclick={() => { filter = 'all'; sourceFilter = null; }}>
      Alle
    </button>
    <button class:active={filter === 'unread' && !sourceFilter} onclick={() => { filter = 'unread'; sourceFilter = null; }}>
      Uleste ({unreadCount})
    </button>
    <button class="sources-toggle" onclick={() => { showSources = !showSources; if (!showSources) editingSources = false; }}>
      Kilder ({sources.length}) {showSources ? '▴' : '▾'}
    </button>
  </nav>

  {#if showSources}
    <div class="sources-header">
      <button
        class="edit-sources-btn"
        class:active={editingSources}
        onclick={() => editingSources = !editingSources}
      >
        {editingSources ? 'Ferdig' : 'Rediger'}
      </button>
    </div>
    <div class="sources-list">
      {#if editingSources}
        {#each sources as source}
          <div class="source-item editing" class:disabled={!source.enabled}>
            <button
              class="source-toggle-btn"
              class:off={!source.enabled}
              onclick={() => handleToggleSource(source.url)}
              title={source.enabled ? 'Deaktiver' : 'Aktiver'}
            >
              {source.enabled ? '●' : '○'}
            </button>
            <span class="source-name">{source.name}</span>
            <button
              class="source-delete-btn"
              onclick={() => handleRemoveSource(source.url, source.name)}
              title="Fjern kilde"
            >
              ×
            </button>
          </div>
        {/each}
        <div class="add-source-form">
          <input
            class="add-source-input"
            type="text"
            placeholder="Navn"
            bind:value={newFeedName}
          />
          <input
            class="add-source-input"
            type="url"
            placeholder="RSS/Atom URL"
            bind:value={newFeedUrl}
            onkeydown={(e) => { if (e.key === 'Enter') handleAddSource(); }}
          />
          <button
            class="add-source-btn"
            onclick={handleAddSource}
            disabled={!newFeedName.trim() || !newFeedUrl.trim()}
          >
            Legg til
          </button>
        </div>
      {:else}
        {#each sources.filter(s => s.enabled) as source}
          {@const count = articleCountBySource()[source.name] || 0}
          <button
            class="source-item"
            class:active={sourceFilter === source.name}
            onclick={() => { sourceFilter = sourceFilter === source.name ? null : source.name; }}
          >
            <span class="source-name">{source.name}</span>
            <span class="source-count">{count}</span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}

  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <p>{loadingStatus}</p>
    </div>
  {:else if errors.length > 0}
    <details class="errors">
      <summary>{errors.length} feeds kunne ikke lastes</summary>
      <ul>
        {#each errors as { source, error }}
          <li>{source.name}: {error}</li>
        {/each}
      </ul>
    </details>
  {/if}

  <section class="articles">
    {#each filteredArticles() as article (article.id)}
      {@const read = article.id in readArticles}
      {@const isNew = isNewSinceLastVisit(article)}
      <article class:read class:new={isNew}>
        <div class="article-header">
          <button
            class="toggle-read"
            onclick={() => handleToggleRead(article.id)}
            title={read ? 'Marker som ulest' : 'Marker som lest'}
          >
            {read ? '○' : '●'}
          </button>
          <button
            class="extract-btn"
            onclick={() => extractContent(article)}
            title="Hent innhold for AI-oppsummering"
          >
            ✦
          </button>
          <div class="meta">
            <span class="source">{article.source}</span>
            <span class="date">{formatDate(article.pubDate)}</span>
            {#if isNew}
              <span class="new-badge">NY</span>
            {/if}
          </div>
        </div>
        <h2>
          <a href={article.link} target="_blank" rel="noopener noreferrer">
            {article.title}
          </a>
        </h2>
        {#if article.description}
          <p class="description">{article.description}</p>
        {/if}
      </article>
    {:else}
      <p class="empty">
        {#if filter === 'unread'}
          Ingen uleste artikler
        {:else}
          Ingen artikler funnet
        {/if}
      </p>
    {/each}
  </section>
</main>

<SidePanel
  open={panelOpen}
  article={selectedArticle}
  content={extractedContent}
  loading={extracting}
  error={extractError}
  onclose={closePanel}
  onretry={retryExtract}
  oncopy={copyToClipboard}
/>
