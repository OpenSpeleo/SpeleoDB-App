package org.speleodb.app;

import static org.junit.Assert.assertTrue;

import android.view.WindowManager;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class MainActivityScreenAwakeTest {
    @Test
    public void foregroundActivityKeepsScreenOn() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                int flags = activity.getWindow().getAttributes().flags;
                assertTrue((flags & WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) != 0);
            });
        }
    }
}
