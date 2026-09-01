package com.readest.native_tts

import android.content.Context
import android.util.Base64
import android.util.Log
import com.k2fsa.sherpa.onnx.GenerationConfig
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsKittenModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsSupertonicModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean

private data class SherpaModelSpec(
    val id: String,
    val family: String,
    val dir: String,
    val archive: String,
    val url: String,
    val modelCandidates: List<String>,
    val extraFiles: List<String>,
)

/**
 * On-device TTS via sherpa-onnx: Kitten, Piper (VITS), and Supertonic 3.
 * Each package is downloaded once into filesDir.
 */
class SherpaKokoroEngine(
    private val context: Context,
    private val onProgress: (Float) -> Unit,
) {
    companion object {
        private const val TAG = "SherpaOnDevice"
        private const val READY_MARKER = ".ready"
        private const val RELEASE =
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models"

        private val MODELS = mapOf(
            "kitten-nano" to SherpaModelSpec(
                id = "kitten-nano",
                family = "kitten",
                dir = "kitten-nano-en-v0_1-fp16",
                archive = "kitten-nano-en-v0_1-fp16.tar.bz2",
                url = "$RELEASE/kitten-nano-en-v0_1-fp16.tar.bz2",
                modelCandidates = listOf("model.fp16.onnx"),
                extraFiles = listOf("voices.bin", "tokens.txt"),
            ),
            "kitten-mini" to SherpaModelSpec(
                id = "kitten-mini",
                family = "kitten",
                dir = "kitten-mini-en-v0_1-fp16",
                archive = "kitten-mini-en-v0_1-fp16.tar.bz2",
                url = "$RELEASE/kitten-mini-en-v0_1-fp16.tar.bz2",
                modelCandidates = listOf("model.fp16.onnx"),
                extraFiles = listOf("voices.bin", "tokens.txt"),
            ),
            "piper-amy-low" to SherpaModelSpec(
                id = "piper-amy-low",
                family = "vits",
                dir = "vits-piper-en_US-amy-low-int8",
                archive = "vits-piper-en_US-amy-low-int8.tar.bz2",
                url = "$RELEASE/vits-piper-en_US-amy-low-int8.tar.bz2",
                modelCandidates = listOf("en_US-amy-low.int8.onnx", "en_US-amy-low.onnx"),
                extraFiles = listOf("tokens.txt"),
            ),
            "piper-lessac-medium" to SherpaModelSpec(
                id = "piper-lessac-medium",
                family = "vits",
                dir = "vits-piper-en_US-lessac-medium-int8",
                archive = "vits-piper-en_US-lessac-medium-int8.tar.bz2",
                url = "$RELEASE/vits-piper-en_US-lessac-medium-int8.tar.bz2",
                modelCandidates = listOf(
                    "en_US-lessac-medium.int8.onnx",
                    "en_US-lessac-medium.onnx",
                ),
                extraFiles = listOf("tokens.txt"),
            ),
            "supertonic-3" to SherpaModelSpec(
                id = "supertonic-3",
                family = "supertonic",
                dir = "sherpa-onnx-supertonic-3-tts-int8-2026-05-11",
                archive = "sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2",
                url = "$RELEASE/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2",
                modelCandidates = listOf("duration_predictor.int8.onnx"),
                extraFiles = listOf(
                    "text_encoder.int8.onnx",
                    "vector_estimator.int8.onnx",
                    "vocoder.int8.onnx",
                    "tts.json",
                    "unicode_indexer.bin",
                    "voice.bin",
                ),
            ),
        )

        private val LEGACY = mapOf(
            "tiny" to "kitten-nano",
            "small" to "kitten-mini",
            "large" to "kitten-mini",
        )

        private val KITTEN_VOICE_SID = mapOf(
            "af" to 1,
            "af_bella" to 1,
            "af_heart" to 1,
            "af_nicole" to 3,
            "af_jessica" to 3,
            "af_sarah" to 5,
            "af_alloy" to 5,
            "af_sky" to 7,
            "af_aoede" to 7,
            "af_nova" to 7,
            "am_adam" to 0,
            "am_echo" to 0,
            "am_liam" to 0,
            "am_puck" to 0,
            "am_michael" to 2,
            "am_eric" to 2,
            "am_fenrir" to 2,
            "bm_george" to 4,
            "bm_daniel" to 4,
            "bm_lewis" to 6,
            "bm_fable" to 6,
        )

        private val SUPERTONIC_VOICE_SID = mapOf(
            "M1" to 0, "M2" to 1, "M3" to 2, "M4" to 3, "M5" to 4,
            "F1" to 5, "F2" to 6, "F3" to 7, "F4" to 8, "F5" to 9,
        )

        fun normalizeId(size: String?): String {
            val raw = size?.trim().orEmpty()
            val mapped = LEGACY[raw] ?: raw
            return if (MODELS.containsKey(mapped)) mapped else "kitten-nano"
        }

        private fun specFor(size: String?): SherpaModelSpec = MODELS[normalizeId(size)]!!
    }

    private var tts: OfflineTts? = null
    private var loadedSpec: SherpaModelSpec? = null
    private val loading = AtomicBoolean(false)

    fun isReadyOnDisk(size: String? = null): Boolean {
        val spec = specFor(size ?: loadedSpec?.id ?: "kitten-nano")
        return isReadyOnDisk(spec)
    }

    fun isLoaded(size: String? = null): Boolean {
        val spec = specFor(size ?: loadedSpec?.id ?: "kitten-nano")
        return tts != null && loadedSpec?.id == spec.id
    }

    @Synchronized
    fun ensureReady(size: String? = "kitten-nano") {
        val spec = specFor(size)
        if (isReadyOnDisk(spec) && tts != null && loadedSpec?.id == spec.id) {
            onProgress(1f)
            return
        }
        if (!loading.compareAndSet(false, true)) {
            while (loading.get()) {
                Thread.sleep(50)
            }
            if (tts != null && loadedSpec?.id == spec.id) return
        }
        try {
            if (loadedSpec?.id != spec.id) {
                releaseLocked()
            }
            if (!isReadyOnDisk(spec)) {
                downloadAndExtract(spec)
            } else {
                onProgress(1f)
            }
            loadEngine(spec)
        } finally {
            loading.set(false)
        }
    }

    @Synchronized
    fun synthesize(
        text: String,
        voice: String?,
        size: String? = "kitten-nano",
        lang: String? = "en",
    ): SherpaAudio {
        ensureReady(size)
        val spec = loadedSpec ?: throw IllegalStateException("On-device TTS is not loaded")
        val engine = tts ?: throw IllegalStateException("On-device TTS is not loaded")
        val sid = sidFor(spec, voice)
        val audio = if (spec.family == "supertonic") {
            val extra = hashMapOf("lang" to (lang?.takeIf { it.isNotBlank() } ?: "en"))
            val config = GenerationConfig(
                sid = sid,
                speed = 1.0f,
                numSteps = 8,
                extra = extra,
            )
            engine.generateWithConfig(text, config)
        } else {
            engine.generate(text, sid, 1.0f)
        }
        val samples = audio.samples
        val sampleRate = audio.sampleRate
        if (samples.isEmpty()) {
            throw IllegalStateException("Sherpa returned an empty PCM buffer")
        }
        val wav = encodeWav(samples, sampleRate)
        val durationSec = samples.size.toDouble() / sampleRate.toDouble()
        return SherpaAudio(
            wavBase64 = Base64.encodeToString(wav, Base64.NO_WRAP),
            sampleRate = sampleRate,
            durationSec = durationSec,
        )
    }

    @Synchronized
    fun release() {
        releaseLocked()
    }

    private fun releaseLocked() {
        try {
            tts?.release()
        } catch (e: Exception) {
            Log.w(TAG, "release failed", e)
        }
        tts = null
        loadedSpec = null
    }

    private fun isReadyOnDisk(spec: SherpaModelSpec): Boolean {
        val root = modelRoot(spec)
        if (!File(root, READY_MARKER).isFile) return false
        if (findModelFile(root, spec) == null) return false
        if (spec.family != "supertonic" && !File(root, "espeak-ng-data").isDirectory) return false
        return spec.extraFiles.all { File(root, it).isFile }
    }

    private fun findModelFile(root: File, spec: SherpaModelSpec): File? {
        return spec.modelCandidates.map { File(root, it) }.firstOrNull { it.isFile }
    }

    private fun modelRoot(spec: SherpaModelSpec): File = File(context.filesDir, spec.dir)

    private fun sidFor(spec: SherpaModelSpec, voice: String?): Int {
        return when (spec.family) {
            "kitten" -> KITTEN_VOICE_SID[voice] ?: 1
            "supertonic" -> SUPERTONIC_VOICE_SID[voice] ?: 5
            else -> 0
        }
    }

    private fun downloadAndExtract(spec: SherpaModelSpec) {
        val root = modelRoot(spec)
        if (root.exists()) root.deleteRecursively()
        root.mkdirs()

        val archive = File(context.cacheDir, spec.archive)
        try {
            downloadFile(spec.url, archive)
            extractTarBz2(archive, context.filesDir)
            val extracted = File(context.filesDir, spec.dir)
            if (!extracted.isDirectory) {
                throw IllegalStateException("Archive did not contain ${spec.dir}")
            }
            File(extracted, READY_MARKER).writeText("ok")
            onProgress(1f)
        } finally {
            if (archive.exists()) archive.delete()
        }
    }

    private fun downloadFile(url: String, dest: File) {
        var current = url
        var redirects = 0
        while (redirects < 6) {
            val connection = (URL(current).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 30_000
                readTimeout = 60_000
                requestMethod = "GET"
            }
            val code = connection.responseCode
            if (code in 300..399) {
                val next = connection.getHeaderField("Location")
                    ?: throw IllegalStateException("Redirect without Location")
                connection.disconnect()
                current = if (next.startsWith("http")) next else URL(URL(current), next).toString()
                redirects++
                continue
            }
            if (code !in 200..299) {
                connection.disconnect()
                throw IllegalStateException("Download failed HTTP $code")
            }
            val total = connection.contentLengthLong.coerceAtLeast(1L)
            connection.inputStream.use { input ->
                FileOutputStream(dest).use { output ->
                    val buf = ByteArray(64 * 1024)
                    var copied = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n <= 0) break
                        output.write(buf, 0, n)
                        copied += n
                        onProgress((copied.toFloat() / total.toFloat()).coerceIn(0f, 1f) * 0.9f)
                    }
                }
            }
            connection.disconnect()
            return
        }
        throw IllegalStateException("Too many redirects downloading on-device voice")
    }

    private fun extractTarBz2(archive: File, destDir: File) {
        BufferedInputStream(archive.inputStream()).use { fileIn ->
            BZip2CompressorInputStream(fileIn).use { bz ->
                TarArchiveInputStream(bz).use { tar ->
                    while (true) {
                        val entry = tar.nextEntry ?: break
                        val outFile = File(destDir, entry.name)
                        if (entry.isDirectory) {
                            outFile.mkdirs()
                            continue
                        }
                        outFile.parentFile?.mkdirs()
                        FileOutputStream(outFile).use { output ->
                            tar.copyTo(output)
                        }
                    }
                }
            }
        }
        onProgress(0.98f)
    }

    private fun loadEngine(spec: SherpaModelSpec) {
        val root = modelRoot(spec)
        val model = OfflineTtsModelConfig(
            vits = if (spec.family == "vits") {
                val modelFile = findModelFile(root, spec)
                    ?: throw IllegalStateException("Piper model file missing")
                OfflineTtsVitsModelConfig(
                    model = modelFile.absolutePath,
                    tokens = File(root, "tokens.txt").absolutePath,
                    dataDir = File(root, "espeak-ng-data").absolutePath,
                )
            } else {
                OfflineTtsVitsModelConfig()
            },
            kitten = if (spec.family == "kitten") {
                OfflineTtsKittenModelConfig(
                    model = findModelFile(root, spec)!!.absolutePath,
                    voices = File(root, "voices.bin").absolutePath,
                    tokens = File(root, "tokens.txt").absolutePath,
                    dataDir = File(root, "espeak-ng-data").absolutePath,
                )
            } else {
                OfflineTtsKittenModelConfig()
            },
            supertonic = if (spec.family == "supertonic") {
                OfflineTtsSupertonicModelConfig(
                    durationPredictor = File(root, "duration_predictor.int8.onnx").absolutePath,
                    textEncoder = File(root, "text_encoder.int8.onnx").absolutePath,
                    vectorEstimator = File(root, "vector_estimator.int8.onnx").absolutePath,
                    vocoder = File(root, "vocoder.int8.onnx").absolutePath,
                    ttsJson = File(root, "tts.json").absolutePath,
                    unicodeIndexer = File(root, "unicode_indexer.bin").absolutePath,
                    voiceStyle = File(root, "voice.bin").absolutePath,
                )
            } else {
                OfflineTtsSupertonicModelConfig()
            },
            numThreads = 2,
            debug = false,
            provider = "cpu",
        )
        tts = OfflineTts(config = OfflineTtsConfig(model = model))
        loadedSpec = spec
        Log.i(TAG, "${spec.family} engine loaded from ${root.absolutePath} (${spec.id})")
    }

    private fun encodeWav(samples: FloatArray, sampleRate: Int): ByteArray {
        val dataSize = samples.size * 2
        val buffer = ByteBuffer.allocate(44 + dataSize).order(ByteOrder.LITTLE_ENDIAN)
        buffer.put("RIFF".toByteArray())
        buffer.putInt(36 + dataSize)
        buffer.put("WAVE".toByteArray())
        buffer.put("fmt ".toByteArray())
        buffer.putInt(16)
        buffer.putShort(1)
        buffer.putShort(1)
        buffer.putInt(sampleRate)
        buffer.putInt(sampleRate * 2)
        buffer.putShort(2)
        buffer.putShort(16)
        buffer.put("data".toByteArray())
        buffer.putInt(dataSize)
        for (sample in samples) {
            val clipped = sample.coerceIn(-1f, 1f)
            val pcm = if (clipped < 0f) (clipped * 0x8000).toInt() else (clipped * 0x7fff).toInt()
            buffer.putShort(pcm.toShort())
        }
        return buffer.array()
    }
}

data class SherpaAudio(
    val wavBase64: String,
    val sampleRate: Int,
    val durationSec: Double,
)
