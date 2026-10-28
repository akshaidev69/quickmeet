import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { getSessionCookie, meetingUrl } from '@/lib/api';
import { API_BASE, color } from '@/lib/tokens';

const SHELL_SCRIPT = `
(function(){
  document.documentElement.dataset.shell = 'mobile';
  document.documentElement.classList.add('is-mobile');
})();
true;
`;

export default function MeetingScreen() {
  const params = useLocalSearchParams<{
    code: string;
    host?: string;
    title?: string;
    name?: string;
    audioOnly?: string;
    mic?: string;
  }>();
  const code = String(params.code || '');
  const asHost = params.host === '1';
  const title = String(params.title || 'Meeting');
  const [cookie, setCookie] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    void getSessionCookie().then((value) => {
      setCookie(value);
      setReady(true);
    });
  }, []);

  const uri = useMemo(
    () => meetingUrl(code, { host: asHost, name: String(params.name || '') }),
    [asHost, code, params.name],
  );

  const cookieScript = cookie
    ? `document.cookie=${JSON.stringify(`${cookie}; path=/`)}; ${SHELL_SCRIPT}`
    : SHELL_SCRIPT;

  function leave() {
    router.replace({
      pathname: '/summary',
      params: {
        code,
        title,
        startedAt: String(startedAt.current),
        endedAt: String(Date.now()),
      },
    });
  }

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={color.g500} />
        <Text style={styles.loadingText}>Opening room…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <WebView
        source={{
          uri,
          headers: cookie ? { Cookie: cookie } : undefined,
        }}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        injectedJavaScriptBeforeContentLoaded={cookieScript}
        injectedJavaScript={SHELL_SCRIPT}
        onMessage={(event) => {
          if (event.nativeEvent.data === 'leave') leave();
        }}
        style={styles.web}
        originWhitelist={['*']}
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(req) => req.url.startsWith(API_BASE) || req.url.startsWith('about:')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.d0 },
  web: { flex: 1, backgroundColor: color.d0 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.d0, gap: 10 },
  loadingText: { color: color.dt2 },
});
