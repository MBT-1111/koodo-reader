package xyz.koodoreader.custom.android;

import org.junit.Test;
import java.util.Arrays;
import java.util.Collections;
import static org.junit.Assert.*;

public class NativeSpeechQueueTest {
    @Test public void cloudRolesNeverMergeAcrossSpeakersAndRetainLongSentenceRoles() {
        NativeSpeechQueue queue = NativeSpeechQueue.cloud(Arrays.asList("旁白。", "男声一。", "男声二。", "😀".repeat(700), "尾声。"), Arrays.asList("narrator", "male", "male", "female", "narrator"));
        assertEquals(Arrays.asList("narrator", "male", "female", "female", "narrator"), queue.roles);
        assertEquals("男声一。\n男声二。", queue.text.get(1));
        assertEquals("旁白。男声一。男声二。" + "😀".repeat(700) + "尾声。", String.join("", queue.text).replace("\n", ""));
        queue.resume(); assertTrue(queue.finish(queue.token())); assertEquals("male", queue.roles.get(queue.index));
        queue.move(1); assertEquals("female", queue.roles.get(queue.index));
    }
    @Test public void rejectsMismatchedOrUnknownRoles() {
        assertThrows(IllegalArgumentException.class, () -> NativeSpeechQueue.cloud(Arrays.asList("one", "two"), Collections.singletonList("male")));
        assertThrows(IllegalArgumentException.class, () -> NativeSpeechQueue.cloud(Collections.singletonList("one"), Collections.singletonList("invented")));
    }
    @Test public void cloudSegmentsPreserveParagraphsAndBoundRequestSize() {
        NativeSpeechQueue queue = NativeSpeechQueue.cloud(Arrays.asList("第一段。", "第二段！", "😀".repeat(1400)));
        assertEquals("第一段。第二段！" + "😀".repeat(1400), String.join("", queue.text).replace("\n", ""));
        for (String part : queue.text) {
            assertTrue(part.length() <= 1200);
            assertFalse(Character.isHighSurrogate(part.charAt(part.length() - 1)));
        }
        assertTrue(queue.text.get(0).contains("第一段。\n第二段！"));
    }
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

    @Test public void continuousCloudKeepsChaptersSeparateAndSkipsEmptyText() {
        NativeSpeechQueue queue = NativeSpeechQueue.cloud(Arrays.asList("First.", "Again.", " ", "Next."), null, Arrays.asList(4, 4, 5, 6));
        assertEquals(Arrays.asList("First.\nAgain.", "Next."), queue.text);
        assertEquals(Arrays.asList(4, 6), queue.chapters);
        queue.resume(); String first = queue.token();
        assertTrue(queue.finish(first)); assertEquals(6, (int) queue.chapters.get(queue.index));
        queue.move(-1); assertFalse(queue.finish(first)); assertEquals(4, (int) queue.chapters.get(queue.index));
        queue.resume(); assertTrue(queue.finish(queue.token()));
        assertTrue(queue.finish(queue.token())); assertFalse(queue.playing);
    }

    @Test public void continuousSystemRetainsChapterForEverySplitSentence() {
        NativeSpeechQueue queue = new NativeSpeechQueue(Arrays.asList("First. Second.", "😀".repeat(4)), 5, Arrays.asList(0, 1));
        assertEquals(Arrays.asList(0, 0, 0, 0, 1, 1), queue.chapters);
        assertEquals("First. Second.".replace(" ", "") + "😀".repeat(4), String.join("", queue.text));
    }

    @Test public void rejectsInvalidChapterMappings() {
        assertThrows(IllegalArgumentException.class, () -> NativeSpeechQueue.cloud(Arrays.asList("One", "Two"), null, Collections.singletonList(0)));
        assertThrows(IllegalArgumentException.class, () -> NativeSpeechQueue.cloud(Arrays.asList("One", "Two"), null, Arrays.asList(1, 0)));
        assertThrows(IllegalArgumentException.class, () -> new NativeSpeechQueue(Collections.singletonList("One"), 100, Collections.singletonList(-1)));
        assertThrows(IllegalArgumentException.class, () -> new NativeSpeechQueue(Collections.singletonList("One"), 100, Collections.singletonList(20000)));
    }
}
