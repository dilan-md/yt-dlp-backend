const express = require('express');
const cors = require('cors');
const youtubedl = require('youtube-dl-exec');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'online', service: 'yt-dlp-backend' });
});

// Endpoint: /api/info — obtener info y calidades reales del video
app.get('/api/info', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Falta la URL' });

    try {
        const output = await youtubedl(url, {
            dumpSingleJson: true,
            noWarnings: true,
            noCallHome: true,
            noCheckCertificates: true,
            preferFreeFormats: true,
        });

        const formats = output.formats || [];
        const videos = formats.filter(f => f.vcodec && f.vcodec !== 'none');
        const audios = formats.filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));

        // Resoluciones únicas ordenadas de mayor a menor
        const qualities = [...new Set(videos.map(v => v.height).filter(h => h))].sort((a, b) => b - a);

        res.json({
            title: output.title || 'Video',
            thumbnail: output.thumbnail || '',
            duration: output.duration || 0,
            qualities: qualities.map(q => `${q}p`),
            hasAudio: audios.length > 0
        });
    } catch (error) {
        console.error('Error en /api/info:', error.stderr || error.message);
        res.status(500).json({ error: `No se pudo obtener info: ${error.stderr || error.message}` });
    }
});

// Endpoint: /api/download — descargar y enviar el archivo
app.get('/api/download', async (req, res) => {
    const { url, quality, format: fmt } = req.query;
    if (!url) return res.status(400).json({ error: 'Falta la URL' });

    const isMp3 = fmt === 'mp3';
    const targetHeight = quality ? quality.replace('p', '') : '720';

    // Carpeta temporal
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const id = uuidv4();
    const ext = isMp3 ? 'mp3' : 'mp4';
    // yt-dlp a veces cambia la extensión, así que usamos un patrón para encontrar el archivo
    const outputTemplate = path.join(tempDir, `${id}.%(ext)s`);
    const expectedPath = path.join(tempDir, `${id}.${ext}`);

    // Construir flags
    const flags = {
        noWarnings: true,
        noCallHome: true,
        noCheckCertificates: true,
        output: outputTemplate,
    };

    if (isMp3) {
        flags.extractAudio = true;
        flags.audioFormat = 'mp3';
        flags.audioQuality = '0';
    } else {
        // Intentar mejor video+audio combinado, con fallbacks progresivos
        flags.format = `bestvideo[height<=${targetHeight}]+bestaudio/best[height<=${targetHeight}]/best`;
        flags.mergeOutputFormat = 'mp4';
    }

    try {
        console.log(`⬇️  Descarga iniciada: ${url} | Calidad: ${targetHeight}p | Formato: ${ext}`);

        await youtubedl(url, flags);

        // Buscar el archivo generado (yt-dlp puede cambiar la extensión)
        const files = fs.readdirSync(tempDir).filter(f => f.startsWith(id));
        if (files.length === 0) {
            throw new Error('yt-dlp terminó pero no generó ningún archivo.');
        }

        const actualFile = path.join(tempDir, files[0]);
        const actualExt = path.extname(files[0]).replace('.', '');
        const stat = fs.statSync(actualFile);

        console.log(`✅ Archivo listo: ${files[0]} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

        const safeTitle = (req.query.title || 'video').replace(/[^a-zA-Z0-9 _-]/g, '_');

        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.${actualExt}"`);
        res.setHeader('Content-Type', isMp3 ? 'audio/mpeg' : 'video/mp4');
        res.setHeader('Content-Length', stat.size);

        const fileStream = fs.createReadStream(actualFile);
        fileStream.pipe(res);

        // Eliminar archivo temporal cuando termine de enviarse
        fileStream.on('end', () => {
            fs.unlink(actualFile, (err) => {
                if (err) console.error('Error eliminando temporal:', err.message);
                else console.log(`🗑️  Temporal eliminado: ${files[0]}`);
            });
        });

        // Si la conexión se corta, limpiar igual
        res.on('close', () => {
            if (fs.existsSync(actualFile)) {
                fs.unlink(actualFile, () => {});
            }
        });

    } catch (error) {
        console.error('❌ Error en descarga:', error.stderr || error.message);
        // Limpiar archivos temporales
        const files = fs.readdirSync(tempDir).filter(f => f.startsWith(id));
        files.forEach(f => {
            try { fs.unlinkSync(path.join(tempDir, f)); } catch (_) {}
        });
        if (!res.headersSent) {
            res.status(500).json({ error: `Error en descarga: ${error.stderr || error.message}` });
        }
    }
});

app.listen(PORT, () => {
    console.log(`🚀 yt-dlp backend corriendo en puerto ${PORT}`);
});
