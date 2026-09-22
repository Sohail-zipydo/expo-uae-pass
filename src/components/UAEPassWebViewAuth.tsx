/**
 * UAE Pass WebView Authentication Component
 * 
 * Self-contained component for UAE Pass app-to-app authentication
 * Handles WebView flow when UAE Pass app IS installed
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  SafeAreaView,
  Text,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import * as Linking from 'expo-linking';
import { getUAEPassConfig, getUAEPassAppSchemes, getUAEPassEnvironment } from '../config/uaePassConfig';

interface UAEPassWebViewAuthProps {
  visible: boolean;
  authUrl: string;
  redirectUri: string;
  expectedState: string;
  onSuccess: (authorizationCode: string, state: string) => void;
  onCancel: () => void;
  onError: (error: string) => void;
}

interface SavedUrls {
  successURL: string;
  failureURL: string;
  originalUrl: string;
}

const UAEPassWebViewAuth: React.FC<UAEPassWebViewAuthProps> = ({
  visible,
  authUrl,
  redirectUri,
  onSuccess,
  onCancel,
  onError,
  expectedState,
}) => {
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [savedUrls, setSavedUrls] = useState<SavedUrls | null>(null);
  const [waitingForCallback, setWaitingForCallback] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(authUrl);

  const config = getUAEPassConfig();
  const appSchemes = getUAEPassAppSchemes();
  const env = getUAEPassEnvironment();
  const UAE_PASS_SCHEME = env === 'production' ? 'uaepass://' : 'uaepassstg://';
  const OUR_APP_SCHEME = redirectUri.split('://')[0] + '://';

  // Handle deep link callbacks from UAE Pass app
  useEffect(() => {
    if (!visible) return;

    const handleDeepLink = (event: Linking.EventType) => {
      console.log('📱 Deep link received:', event.url);
      
      // Check if this is our resume callback
      if (event.url.includes('resume_authn') || event.url.includes(redirectUri)) {
        // Extract the original URL if it's encoded in the callback
        const normalizedUrl = event.url.replace(OUR_APP_SCHEME, 'https://');
        const urlParams = new URL(normalizedUrl);
        const resumeUrl = urlParams.searchParams.get('url');
        
        if (resumeUrl && savedUrls) {
          console.log('📱 Resuming auth with URL:', resumeUrl);
          const decodedUrl = decodeURIComponent(resumeUrl);
          setCurrentUrl(decodedUrl);
          setWaitingForCallback(false);
        } else if (event.url.includes('code=')) {
          // Direct callback with authorization code
          parseAuthorizationCode(event.url);
        }
      }
    };

    const subscription = Linking.addEventListener('url', handleDeepLink);
    
    // Check if app was opened with a URL
    Linking.getInitialURL().then((url: string | null) => {
      if (url && waitingForCallback) {
        handleDeepLink({ url });
      }
    });

    return () => {
      subscription.remove();
    };
  }, [savedUrls, waitingForCallback, visible, redirectUri, OUR_APP_SCHEME]);

  // Parse authorization code from URL
  const parseAuthorizationCode = useCallback((url: string) => {
    try {
      const normalizedUrl = url.replace(OUR_APP_SCHEME, 'https://');
      const parsedUrl = new URL(normalizedUrl);
      const code = parsedUrl.searchParams.get('code');
      const state = parsedUrl.searchParams.get('state');
      const error = parsedUrl.searchParams.get('error');
      const errorDescription = parsedUrl.searchParams.get('error_description');

      if (error) {
        console.error('OAuth error:', error, errorDescription);
        onError(errorDescription || error);
        return;
      }

      if (state !== expectedState) {
        console.error('State mismatch! Expected:', expectedState, 'Got:', state);
        onError('Invalid state parameter - possible CSRF attack');
        return;
      }

      if (code) {
        console.log('✅ Authorization code received!');
        onSuccess(code, state || '');
      } else {
        onError('No authorization code received');
      }
    } catch (err) {
      console.error('Error parsing callback URL:', err);
      onError('Failed to parse callback URL');
    }
  }, [expectedState, onSuccess, onError, OUR_APP_SCHEME]);

  // Handle WebView navigation state changes
  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    console.log('🌐 WebView navigating to:', navState.url);
    
    // Check if we got the authorization code directly
    if (navState.url.startsWith(redirectUri) || navState.url.includes('code=')) {
      if (navState.url.includes('code=')) {
        parseAuthorizationCode(navState.url);
      }
    }
  }, [redirectUri, parseAuthorizationCode]);

  // Intercept requests to check for UAE Pass deep link
  const handleShouldStartLoadWithRequest = useCallback((request: { url: string }) => {
    const url = request.url;
    console.log('🔗 WebView request:', url);

    // Check if this is a UAE Pass deep link that we need to intercept
    if (url.startsWith(UAE_PASS_SCHEME) || url.startsWith('uaepassstg://') || url.startsWith('uaepass://')) {
      console.log('🎯 Intercepted UAE Pass deep link!');
      
      try {
        // Parse the UAE Pass deep link
        const normalizedUrl = url.replace(UAE_PASS_SCHEME, 'https://').replace('uaepassstg://', 'https://').replace('uaepass://', 'https://');
        const urlObj = new URL(normalizedUrl);
        
        // UAE PASS sometimes sends successURL/failureURL in lowercase
        const successURL =
          urlObj.searchParams.get('successURL') ||
          urlObj.searchParams.get('successurl');
        const failureURL =
          urlObj.searchParams.get('failureURL') ||
          urlObj.searchParams.get('failureurl');

        console.log('📋 Original successURL:', successURL);
        console.log('📋 Original failureURL:', failureURL);

        // Check if this is already a rewritten URL
        if (successURL && successURL.includes(OUR_APP_SCHEME)) {
          console.log('✅ This is already rewritten URL - opening UAE Pass app directly');
          setWaitingForCallback(true);
          
          let openUrl = url;
          if (env === 'staging' && url.startsWith('uaepass://')) {
            openUrl = url.replace('uaepass://', 'uaepassstg://');
          }
          
          Linking.openURL(openUrl).catch((err: Error) => {
            console.error('Failed to open UAE Pass app:', err);
            onError('Failed to open UAE Pass app');
          });
          
          return false;
        }

        if (successURL && failureURL) {
          // Save the original URLs
          setSavedUrls({
            successURL: decodeURIComponent(successURL),
            failureURL: decodeURIComponent(failureURL),
            originalUrl: url,
          });

          // Rewrite URLs with our app scheme for callback
          const encodedSuccessURL = encodeURIComponent(successURL);
          const encodedFailureURL = encodeURIComponent(failureURL);
          
          // Build our callback URL format
          const ourSuccessCallback = `${OUR_APP_SCHEME}auth/uaepass/resume?url=${encodedSuccessURL}`;
          const ourFailureCallback = `${OUR_APP_SCHEME}auth/uaepass/resume?url=${encodedFailureURL}`;

          // Rebuild the UAE Pass URL with our callbacks
          urlObj.searchParams.set('successURL', ourSuccessCallback);
          urlObj.searchParams.set('failureURL', ourFailureCallback);
          urlObj.searchParams.set('successurl', ourSuccessCallback);
          urlObj.searchParams.set('failureurl', ourFailureCallback);
          
          // Convert back to UAE Pass scheme
          const rewrittenUrl = url.split('?')[0] + '?' + urlObj.searchParams.toString();
          
          console.log('🔄 Rewritten UAE Pass URL:', rewrittenUrl);
          console.log('📱 Opening UAE Pass app with rewritten URL...');

          setWaitingForCallback(true);

          let openUrl = rewrittenUrl;
          if (env === 'staging' && rewrittenUrl.startsWith('uaepass://')) {
            openUrl = rewrittenUrl.replace('uaepass://', 'uaepassstg://');
          }
          
          Linking.openURL(openUrl).catch((err: Error) => {
            console.error('Failed to open UAE Pass app:', err);
            onError('Failed to open UAE Pass app');
          });
          
          return false;
        } else {
          // No success/failure URLs, try to open directly
          console.log('📱 No successURL/failureURL found, opening directly...');
          let openUrl = url;
          if (env === 'staging' && url.startsWith('uaepass://')) {
            openUrl = url.replace('uaepass://', 'uaepassstg://');
          }

          Linking.openURL(openUrl).catch((err: Error) => {
            console.error('Failed to open UAE Pass:', err);
            onError('Failed to open UAE Pass app');
          });
          return false;
        }
      } catch (err: any) {
        console.error('Error processing UAE Pass deep link:', err);
        let openUrl = url;
        if (env === 'staging' && url.startsWith('uaepass://')) {
          openUrl = url.replace('uaepass://', 'uaepassstg://');
        }
        Linking.openURL(openUrl).catch(() => {
          onError('Failed to process UAE Pass authentication');
        });
        return false;
      }
    }

    // Check if this is our redirect URI with auth code
    if (url.startsWith(redirectUri) || (url.includes(redirectUri.replace(OUR_APP_SCHEME, '')))) {
      console.log('🎉 Got redirect with auth code!');
      parseAuthorizationCode(url);
      return false;
    }

    // Allow all other URLs
    return true;
  }, [redirectUri, parseAuthorizationCode, onError, UAE_PASS_SCHEME, OUR_APP_SCHEME, env]);

  // Handle WebView load when waiting for callback and URL changes
  useEffect(() => {
    if (currentUrl !== authUrl && webViewRef.current) {
      console.log('📱 Loading new URL in WebView:', currentUrl);
    }
  }, [currentUrl, authUrl]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onCancel}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel} style={styles.closeButton}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>UAE Pass Authentication</Text>
          <View style={styles.placeholder} />
        </View>

        {/* WebView */}
        <View style={styles.webViewContainer}>
          {loading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#00a651" />
              <Text style={styles.loadingText}>
                {waitingForCallback ? 'Waiting for UAE Pass...' : 'Loading...'}
              </Text>
            </View>
          )}
          
          <WebView
            ref={webViewRef}
            source={{ uri: currentUrl }}
            style={styles.webView}
            onNavigationStateChange={handleNavigationStateChange}
            onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={(syntheticEvent: any) => {
              const { nativeEvent } = syntheticEvent;
              console.error('WebView error:', nativeEvent);
              const url = nativeEvent.url || '';
              if (
                url.startsWith(UAE_PASS_SCHEME) ||
                url.startsWith('uaepass://') ||
                url.startsWith('uaepassstg://') ||
                nativeEvent.code === -10
              ) {
                console.log('ℹ️  Ignoring expected WebView error for custom scheme:', url);
                return;
              }
              onError(`WebView error: ${nativeEvent.description}`);
            }}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            startInLoadingState={true}
            scalesPageToFit={true}
            mixedContentMode="always"
            allowsBackForwardNavigationGestures={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            originWhitelist={['*']}
            setSupportMultipleWindows={false}
          />
        </View>

        {/* Info when waiting */}
        {waitingForCallback && (
          <View style={styles.waitingBanner}>
            <Text style={styles.waitingText}>
              Complete authentication in UAE Pass app, then return here
            </Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  closeButton: {
    padding: 8,
    width: 44,
  },
  closeText: {
    fontSize: 20,
    color: '#333',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  placeholder: {
    width: 44,
  },
  webViewContainer: {
    flex: 1,
    position: 'relative',
  },
  webView: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
  waitingBanner: {
    backgroundColor: '#00a651',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  waitingText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 14,
  },
});

export default UAEPassWebViewAuth;

