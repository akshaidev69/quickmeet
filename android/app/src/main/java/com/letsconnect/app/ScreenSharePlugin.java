package com.letsconnect.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Captures the device screen via MediaProjection and streams JPEG frames to JS.
 * Web code draws frames onto a canvas and uses canvas.captureStream() for WebRTC.
 */
@CapacitorPlugin(name = "ScreenShare")
public class ScreenSharePlugin extends Plugin {
    private static final int MAX_WIDTH = 720;
    private static final int JPEG_QUALITY = 55;
    private static final long MIN_FRAME_GAP_MS = 66; // ~15 fps

    private MediaProjectionManager projectionManager;
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private PluginCall pendingStart;
    private volatile boolean capturing = false;
    private long lastFrameAt = 0;
    private int captureWidth;
    private int captureHeight;
    private int captureDensity;

    @Override
    public void load() {
        projectionManager = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", projectionManager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP);
        call.resolve(result);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (capturing) {
            call.resolve();
            return;
        }
        if (projectionManager == null) {
            call.reject("Screen share is not supported on this device.");
            return;
        }
        // MediaProjection UI leaves the activity — don't auto-PiP until capture is ready.
        Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            ((MainActivity) activity).setSuppressPip(true);
        }
        pendingStart = call;
        Intent intent = projectionManager.createScreenCaptureIntent();
        startActivityForResult(call, intent, "onProjectionResult");
    }

    @ActivityCallback
    private void onProjectionResult(PluginCall call, ActivityResult result) {
        if (pendingStart == null) pendingStart = call;
        PluginCall startCall = pendingStart;
        pendingStart = null;

        Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            ((MainActivity) activity).setSuppressPip(false);
        }

        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            if (startCall != null) startCall.reject("Screen share permission denied.");
            return;
        }

        try {
            Intent service = new Intent(getContext(), ScreenCaptureService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(service);
            } else {
                getContext().startService(service);
            }

            mediaProjection = projectionManager.getMediaProjection(result.getResultCode(), result.getData());
            if (mediaProjection == null) {
                if (startCall != null) startCall.reject("Could not start screen capture.");
                return;
            }

            prepareCaptureSize();
            captureThread = new HandlerThread("LetsConnectScreenShare");
            captureThread.start();
            captureHandler = new Handler(captureThread.getLooper());

            imageReader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2);
            imageReader.setOnImageAvailableListener(this::onImageAvailable, captureHandler);

            mediaProjection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    getActivity().runOnUiThread(() -> stopInternal());
                }
            }, captureHandler);

            virtualDisplay = mediaProjection.createVirtualDisplay(
                "LetsConnectShare",
                captureWidth,
                captureHeight,
                captureDensity,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(),
                null,
                captureHandler
            );

            capturing = true;
            if (startCall != null) {
                JSObject ok = new JSObject();
                ok.put("width", captureWidth);
                ok.put("height", captureHeight);
                startCall.resolve(ok);
            }
        } catch (Exception error) {
            stopInternal();
            if (startCall != null) startCall.reject(error.getMessage() != null ? error.getMessage() : "Screen share failed.");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopInternal();
        call.resolve();
    }

    private void prepareCaptureSize() {
        WindowManager wm = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);
        DisplayMetrics metrics = new DisplayMetrics();
        wm.getDefaultDisplay().getRealMetrics(metrics);
        captureDensity = metrics.densityDpi;
        float scale = Math.min(1f, (float) MAX_WIDTH / Math.max(metrics.widthPixels, 1));
        captureWidth = Math.max(2, ((int) (metrics.widthPixels * scale)) & ~1);
        captureHeight = Math.max(2, ((int) (metrics.heightPixels * scale)) & ~1);
    }

    private void onImageAvailable(ImageReader reader) {
        if (!capturing) return;
        Image image = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null) return;
            long now = System.currentTimeMillis();
            if (now - lastFrameAt < MIN_FRAME_GAP_MS) return;
            lastFrameAt = now;

            Image.Plane[] planes = image.getPlanes();
            ByteBuffer buffer = planes[0].getBuffer();
            int pixelStride = planes[0].getPixelStride();
            int rowStride = planes[0].getRowStride();
            int rowPadding = rowStride - pixelStride * captureWidth;

            Bitmap bitmap = Bitmap.createBitmap(
                captureWidth + rowPadding / pixelStride,
                captureHeight,
                Bitmap.Config.ARGB_8888
            );
            bitmap.copyPixelsFromBuffer(buffer);
            Bitmap cropped = Bitmap.createBitmap(bitmap, 0, 0, captureWidth, captureHeight);
            if (cropped != bitmap) bitmap.recycle();

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            cropped.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out);
            cropped.recycle();
            String data = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);

            JSObject frame = new JSObject();
            frame.put("data", data);
            frame.put("width", captureWidth);
            frame.put("height", captureHeight);
            notifyListeners("frame", frame);
        } catch (Exception ignored) {
            /* drop frame */
        } finally {
            if (image != null) image.close();
        }
    }

    private void stopInternal() {
        capturing = false;
        try {
            if (virtualDisplay != null) {
                virtualDisplay.release();
                virtualDisplay = null;
            }
        } catch (Exception ignored) {}
        try {
            if (imageReader != null) {
                imageReader.setOnImageAvailableListener(null, null);
                imageReader.close();
                imageReader = null;
            }
        } catch (Exception ignored) {}
        try {
            if (mediaProjection != null) {
                mediaProjection.stop();
                mediaProjection = null;
            }
        } catch (Exception ignored) {}
        try {
            if (captureThread != null) {
                captureThread.quitSafely();
                captureThread = null;
                captureHandler = null;
            }
        } catch (Exception ignored) {}
        try {
            getContext().stopService(new Intent(getContext(), ScreenCaptureService.class));
        } catch (Exception ignored) {}
        notifyListeners("stopped", new JSObject());
    }

    @Override
    protected void handleOnDestroy() {
        stopInternal();
        super.handleOnDestroy();
    }
}
