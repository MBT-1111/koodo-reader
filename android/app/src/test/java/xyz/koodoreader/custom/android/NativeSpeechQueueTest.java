package xyz.koodoreader.custom.android;

import org.junit.Test;
import java.util.Arrays;
import java.util.Collections;
import static org.junit.Assert.*;

public class NativeSpeechQueueTest {
    @Test public void preservesChineseSentencesAndSurrogatePairs() {
        NativeSpeechQueue queue = new NativeSpeechQueue(Arrays.asList("第一句。第二句！", "ab😀cd"), 3);
        assertEquals(Arrays.asList("第一句", "。", "第二句", "！", "ab", "😀c", "d"), queue.text);
        assertEquals("第一句。第二句！ab😀cd", String.join("", queue.text));
    }
    @Test public void pausedAndReplacedUtterancesCannotAdvance() {
        NativeSpeechQueue queue = new NativeSpeechQueue(Collections.singletonList("One. Two. Three."), 100);
        queue.resume(); String old = queue.token();
        queue.pause(); assertFalse(queue.finish(old)); assertEquals(0, queue.index);
        queue.resume(); assertFalse(queue.finish(old));
        String active = queue.token(); assertTrue(queue.finish(active)); assertEquals(1, queue.index);
        assertFalse(queue.finish(active)); assertEquals(1, queue.index);
        NativeSpeechQueue replacement = new NativeSpeechQueue(Collections.singletonList("New book."), 100);
        replacement.resume(); assertFalse(replacement.finish(old)); assertTrue(replacement.playing);
    }
    @Test public void skipAndCompletionStayWithinQueue() {
        NativeSpeechQueue queue = new NativeSpeechQueue(Collections.singletonList("One. Two."), 100);
        queue.move(-1); assertEquals(0, queue.index);
        queue.resume(); String old = queue.token(); queue.move(1);
        assertFalse(queue.finish(old)); assertEquals(1, queue.index);
        queue.resume(); assertTrue(queue.finish(queue.token())); assertFalse(queue.playing);
        queue.move(1); assertEquals(1, queue.index);
    }
    @Test public void rejectsEmptyAndOversizedInput() {
        assertThrows(IllegalArgumentException.class, () -> new NativeSpeechQueue(Collections.singletonList("  \n "), 100));
        assertThrows(IllegalArgumentException.class, () -> new NativeSpeechQueue(Collections.singletonList("a".repeat(2000001)), 3500));
    }
}
