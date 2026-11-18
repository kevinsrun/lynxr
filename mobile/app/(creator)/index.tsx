import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { entries, remaining, scriptTitle, statusLabel } from '../../src/contracts';
import { CreatorError } from '../../src/creator-api';
import { useLibrary } from '../../src/library';
import { client } from '../../src/native-client';
import { Button, color, ErrorText, Screen, styles } from '../../src/ui';
import { parseVideoLink } from '../../src/video';

export default function Home() {
  const router = useRouter();
  const { api, data, allowance, error: refreshError, refresh } = useLibrary();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<'submit' | 'signout' | null>(null);
  const locked = useRef(false);
  const valid = parseVideoLink(url);
  const room = allowance ? remaining(allowance) : null;
  const jobs = useMemo(() => entries(data)
    .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || '')), [data]);

  const open = (id: string) => router.push({ pathname: '/scripts/[id]', params: { id } });

  async function submit() {
    if (locked.current || !valid) return;
    locked.current = true;
    setError(null);
    setAction('submit');
    try {
      const id = await api.submit(url);
      setUrl('');
      // Refresh before opening the new job. A failed read doesn't invalidate
      // the acknowledgement; the detail screen offers a refresh of its own.
      await refresh();
      open(id);
    } catch (err) {
      setError(err instanceof CreatorError ? err.message : 'Couldn’t send this link. Try again.');
      void refresh();
    } finally {
      setAction(null);
      locked.current = false;
    }
  }

  async function signOut() {
    if (locked.current) return;
    locked.current = true;
    setError(null);
    setAction('signout');
    try {
      const result = await client!.auth.signOut({ scope: 'local' });
      if (result.error) setError('Couldn’t sign out. Check your connection and try again.');
    } catch {
      setError('Couldn’t sign out. Check your connection and try again.');
    } finally {
      setAction(null);
      locked.current = false;
    }
  }

  return <Screen>
    <View style={styles.bar}>
      <Text style={styles.kicker}>Lynxr / Make and Post</Text>
      <Button secondary label={action === 'signout' ? 'Signing out…' : 'Sign out'} disabled={!!action} onPress={signOut} />
    </View>
    <Text accessibilityRole="header" style={styles.h1}>Make a script</Text>
    <View style={styles.card}>
      <Text style={styles.kicker}>Script allowance</Text>
      {room === null ? <Text style={styles.dim}>{data || refreshError ? 'Allowance unavailable' : 'Checking…'}</Text>
        : <View style={styles.bar}><Text style={styles.h1}>{room}</Text><Text style={styles.dim}>scripts available</Text></View>}
    </View>
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.h2}>Paste a video link</Text>
      <Text style={styles.dim}>Use a public TikTok video or Instagram reel. You’ll get the video’s original script and shots.</Text>
      <TextInput accessibilityLabel="Video link" style={styles.input} value={url}
        onChangeText={(value) => { setUrl(value); setError(null); }}
        placeholder="https://…" placeholderTextColor={color.dim} autoCapitalize="none" autoCorrect={false}
        keyboardType="url" returnKeyType="go" onSubmitEditing={submit} editable={!action} />
      {!!url.trim() && <Text style={styles.dim}>{valid ? `${valid.platform} link` : 'Enter the full link to one video.'}</Text>}
      <Button label={action === 'submit' ? 'Sending…' : 'Get script'} disabled={!valid || !!action} onPress={submit} />
      <ErrorText message={error} />
    </View>
    <View style={styles.bar}>
      <Text accessibilityRole="header" style={styles.h2}>Your library</Text>
      <Button secondary label="Refresh" onPress={() => void refresh()} />
    </View>
    <ErrorText message={refreshError} />
    {!jobs.length && !refreshError && <Text style={styles.dim}>{data ? 'Your scripts will appear here.' : 'Loading your library…'}</Text>}
    {jobs.map((job) => <Pressable key={job.id} accessibilityRole="button" onPress={() => open(job.id)} style={styles.card}>
      <Text style={styles.kicker}>{statusLabel(job)}</Text>
      <Text style={styles.body}>{scriptTitle(job, data)}</Text>
      {!!job.brandName && <Text style={styles.dim}>{job.brandName}</Text>}
    </Pressable>)}
  </Screen>;
}
