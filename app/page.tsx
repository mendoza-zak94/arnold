/**
 * The status page. Not a dashboard - Arnold is a chat bot, and the data lives in
 * the chat and in your database. This page exists so that "is my deployment
 * alive" has an answer you can reach from a browser.
 */

export const dynamic = 'force-dynamic';

async function health(): Promise<{ ok: boolean; next: string | null; checks: { name: string; ok: boolean; detail: string }[] } | null> {
  try {
    const { GET } = await import('./api/health/route');
    const res = await GET();
    return await res.json();
  } catch {
    return null;
  }
}

export default async function Page() {
  const data = await health();

  return (
    <main style={styles.main}>
      <h1 style={styles.h1}>Chad</h1>
      <p style={styles.lead}>
        A Telegram bot that logs what you eat, drink, smoke and train, by talking to it.
        This page only reports whether the deployment is healthy.
      </p>

      {!data && <p style={styles.bad}>Health check could not run at all. Check the function logs.</p>}

      {data && (
        <>
          <p style={data.ok ? styles.good : styles.bad}>
            {data.ok ? 'All checks passed. Send your bot a message.' : `Not ready yet: ${data.next}`}
          </p>
          <ul style={styles.list}>
            {data.checks.map((c) => (
              <li key={c.name} style={styles.item}>
                <span style={c.ok ? styles.dotOk : styles.dotBad} />
                <strong style={styles.name}>{c.name}</strong>
                <span style={styles.detail}>{c.detail}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p style={styles.foot}>
        Setup instructions are in the repository README. Machine readable status: <code>/api/health</code>
      </p>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    maxWidth: 640,
    margin: '0 auto',
    padding: '3rem 1.5rem',
    lineHeight: 1.6,
    color: '#111',
  },
  h1: { fontSize: '2rem', margin: '0 0 0.5rem' },
  lead: { color: '#555', marginTop: 0 },
  good: { background: '#effaf1', border: '1px solid #b7e4c2', padding: '0.75rem 1rem', borderRadius: 8 },
  bad: { background: '#fdf0ef', border: '1px solid #f3c0bb', padding: '0.75rem 1rem', borderRadius: 8 },
  list: { listStyle: 'none', padding: 0, margin: '1.5rem 0' },
  item: { display: 'flex', gap: '0.6rem', alignItems: 'baseline', padding: '0.4rem 0', borderBottom: '1px solid #eee' },
  dotOk: { width: 8, height: 8, borderRadius: 4, background: '#2f9e44', flex: '0 0 auto' },
  dotBad: { width: 8, height: 8, borderRadius: 4, background: '#e03131', flex: '0 0 auto' },
  name: { minWidth: 150, fontSize: '0.9rem' },
  detail: { color: '#555', fontSize: '0.9rem' },
  foot: { color: '#777', fontSize: '0.85rem', marginTop: '2rem' },
};
