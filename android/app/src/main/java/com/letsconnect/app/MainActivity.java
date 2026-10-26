package com.letsconnect.app;

import android.Manifest;
import android.app.PictureInPictureParams;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import android.view.View;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;

import com.capacitorjs.plugins.app.AppPlugin;
import com.capacitorjs.plugins.browser.BrowserPlugin;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    private static final int MEDIA_PERMISSION_REQUEST = 2401;

    private boolean meetingActive = false;
    private boolean suppressPip = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register before BridgeActivity wires the WebView bridge.
        registerPlugin(BrowserPlugin.class);
        registerPlugin(AppPlugin.class);
        registerPlugin(ScreenSharePlugin.class);
        registerPlugin(MeetingChromePlugin.class);
        super.onCreate(savedInstanceState);
        requestMeetingPermissions();
    }

    @Override
    public void onStart() {
        super.onStart();
        if (this.bridge == null || this.bridge.getWebView() == null) return;

        WebView webView = this.bridge.getWebView();
        WebSettings settings = webView.getSettings();
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);

        // Stop Android Autofill / password manager from hijacking auth fields.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        }

        webView.setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // Grant camera, mic, and screen-capture resources for WebRTC / getDisplayMedia.
                MainActivity.this.runOnUiThread(() -> {
                    try {
                        request.grant(request.getResources());
                    } catch (Exception ignored) {
                        request.deny();
                    }
                });
            }
        });
    }

    @Override
    public void onPause() {
        super.onPause();
        // Keep the meeting WebView painting while minimized in PiP.
        if (isInPipMode() && this.bridge != null && this.bridge.getWebView() != null) {
            WebView webView = this.bridge.getWebView();
            webView.onResume();
            webView.resumeTimers();
        }
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (meetingActive && !suppressPip) {
            enterPip();
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        }
        if (this.bridge == null || this.bridge.getWebView() == null) return;
        WebView webView = this.bridge.getWebView();
        webView.setVisibility(View.VISIBLE);
        if (isInPictureInPictureMode) {
            webView.onResume();
            webView.resumeTimers();
        }
    }

    public void setMeetingActive(boolean active) {
        meetingActive = active;
        if (!active) {
            suppressPip = false;
        }
    }

    public void setSuppressPip(boolean suppress) {
        suppressPip = suppress;
    }

    public boolean isInPipMode() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isInPictureInPictureMode();
    }

    public boolean enterPip() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        if (isInPictureInPictureMode()) return true;
        if (!meetingActive) return false;
        try {
            Rational ratio = new Rational(9, 16);
            PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder()
                .setAspectRatio(ratio);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                builder.setAutoEnterEnabled(false);
                builder.setSeamlessResizeEnabled(true);
            }
            return enterPictureInPictureMode(builder.build());
        } catch (Exception ignored) {
            return false;
        }
    }

    private void requestMeetingPermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        ActivityCompat.requestPermissions(
            this,
            new String[] {
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.MODIFY_AUDIO_SETTINGS
            },
            MEDIA_PERMISSION_REQUEST
        );
    }
}
