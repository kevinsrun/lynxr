import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { entries, scriptSections, scriptTitle, statusLabel } from '../../../src/contracts';
import { canRetry, CreatorError } from '../../../src/creator-api';
import { useLibrary } from '../../../src/library';
import { Button, ErrorText, Screen, styles } from '../../../src/ui';

export default function ScriptDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { api, data, error: refreshError, refresh } = useLibrary();
  const job = entries(data).find((entry) => entry.id === id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const sections = job ? scriptSections(job) : [];

  async function retry() {
    if (!job || lock.current) return;
    lock.current = true;
    setError(null);
    setBusy(true);
    try {
      await api.retry(job.id);
      await refresh();
    } catch (err) {
      setError(err instanceof CreatorError ? err.message : 'Couldn’t retry this script. Try again.');
      void refresh();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <Screen>
    <View style={styles.bar}>
      <Button secondary label="Back to library" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} />
      <Button secondary label="Refresh" onPress={() => void refresh()} />
    </View>
    <Text accessibilityRole="header" style={styles.h1}>{job ? scriptTitle(job, data) : 'Script'}</Text>
    <ErrorText message={refreshError} />
    {!job && !refreshError && <Text style={styles.dim}>{data ? 'This script isn’t in your library.' : 'Loading script…'}</Text>}
    {job && <>
      <View style={styles.card} accessibilityLiveRegion="polite">
        <Text style={styles.kicker}>{statusLabel(job)}</Text>
        {job.status === 'queued' && <Text style={styles.body}>Waiting for the worker. You can leave and check your library later.</Text>}
        {job.status === 'running' && <Text style={styles.body}>Your script is being prepared.</Text>}
        {job.status === 'error' && <Text style={styles.body}>
          {job.noteKind && job.note ? job.note : job.retrying ? 'We’ll try again automatically.' : 'This script couldn’t be completed.'}
        </Text>}
        {job.status === 'done' && sections.length === 0 && <Text style={styles.dim}>There is no script text available for this video.</Text>}
        {canRetry(job) && <Button label={busy ? 'Retrying…' : 'Try again'} disabled={busy} onPress={retry} />}
        <ErrorText message={error} />
      </View>
      {sections.map(({ title, lines }) => <View key={title} style={styles.card}>
        <Text accessibilityRole="header" style={styles.h2}>{title}</Text>
        {lines.map((line, index) => <Text key={index} selectable style={styles.body}>{line}</Text>)}
      </View>)}
    </>}
  </Screen>;
}
