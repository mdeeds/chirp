// --- Constants ---
const CHIRP_DURATION_S = 10;
const START_FREQ_HZ = 20;
const END_FREQ_HZ = 20000;
const MIN_DB = -100;
const MAX_DB = 0;
// PLOT_POINT_DOWNSAMPLE_FACTOR removed - will calculate dynamically

// --- DOM Elements ---
const startButton = document.getElementById('startButton');
const statusDiv = document.getElementById('status');
const canvas = document.getElementById('plotCanvas');
const ctx = canvas.getContext('2d');

// --- State Variables ---
let audioCtx = null;
let mediaRecorder = null;
let recordedChunks = [];
let chartInstance = null;
let isProcessing = false;
let audioStream = null; // To keep track of the stream

// --- Initialization ---
function initializeChart() {
  if (chartInstance) {
    chartInstance.destroy();
  }

  const customXTicks = [
    // Add all the specific frequency values you want ticks for
    20, 30, 60,
    100, 200, 300, 600,
    1000, 2000, 3000, 6000,
    10000, 20000
    // Example: If you wanted 1, 3, 6, 10... you'd list them here:
    // 1, 3, 6, 10, 30, 60, 100, 300, 600, 1000, 3000, 6000, 10000 ...
    // Adjust this list based on the exact ticks you need within your START_FREQ/END_FREQ range
  ];

  chartInstance = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Max Value (dB)',
          data: [],
          borderColor: 'rgb(239, 68, 68)', // Red-500
          backgroundColor: 'rgba(239, 68, 68, 0.5)', // Lighter red
          pointRadius: 1,
          pointHoverRadius: 3,
          showLine: false, // Keep as scatter points
        },
        {
          label: 'RMS Value (dB)',
          data: [],
          borderColor: 'rgb(59, 130, 246)', // Blue-500
          backgroundColor: 'rgba(59, 130, 246, 0.5)', // Lighter blue
          pointRadius: 1,
          pointHoverRadius: 3,
          showLine: false, // Keep as scatter points
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        x: {
          type: 'logarithmic',
          title: { display: true, text: 'Frequency (Hz)' },
          min: START_FREQ_HZ,
          max: END_FREQ_HZ,
          ticks: {
            // --- Modify the callback function ---
            callback: function (value, index, ticks) {
              // Check if the current tick value is close to one of our custom values
              // Use a small tolerance due to potential floating point inaccuracies
              const tolerance = 0.01;
              const isCustomTick = customXTicks.some(customTick =>
                Math.abs(value - customTick) < tolerance * customTick // Relative tolerance
              );

              if (isCustomTick) {
                // Format the label as needed (e.g., add 'k' for thousands)
                if (value >= 1000) {
                  return (value / 1000) + 'k';
                }
                return value.toString(); // Return the number as a string
              } else {
                // Return null or undefined to hide the label for this tick
                return null;
              }
            },
            // --- Remove or comment out maxTicksLimit ---
            // maxTicksLimit: 15, // This might prevent Chart.js from generating ticks near your custom values
            autoSkip: false, // Prevent Chart.js from automatically skipping ticks
            maxRotation: 0, // Keep labels horizontal
            minRotation: 0
          },
          grid: { color: 'rgba(200, 200, 200, 0.2)' }
        },
        y: {
          type: 'linear',
          title: { display: true, text: 'Magnitude (dB)' },
          min: MIN_DB,
          max: MAX_DB,
          grid: { color: 'rgba(200, 200, 200, 0.2)' }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: function (context) {
              let label = context.dataset.label || '';
              if (label) label += ': ';
              if (context.parsed.x !== null) label += `${context.parsed.x.toFixed(1)} Hz`;
              if (context.parsed.y !== null) label += `, ${context.parsed.y.toFixed(1)} dB`;
              return label;
            }
          }
        },
        legend: {
          display: true, // Show legend for the two datasets
          position: 'top',
          labels: {
            padding: 15,
            boxWidth: 12,
            font: { size: 10 }
          }
        }
      },
      animation: false,
      parsing: false,
    }
  });
}

// --- Helper Functions ---
function setStatus(message) {
  statusDiv.textContent = message;
}

function timeToFrequency(t, duration, fStart, fEnd) {
  if (t < 0) t = 0;
  if (t > duration) t = duration;
  return fStart * Math.pow(fEnd / fStart, t / duration);
}

function amplitudeToDb(amplitude) {
  const epsilon = 1e-9; // -180 dB
  const absAmp = Math.abs(amplitude); // Ensure positive value for log
  const db = 20 * Math.log10(absAmp + epsilon);
  return Math.max(MIN_DB, Math.min(MAX_DB, db));
}


// --- Core Logic ---
async function startProcess() {
  if (isProcessing) {
    setStatus("Process already running.");
    return;
  }
  isProcessing = true;
  startButton.disabled = true;
  setStatus("Initializing...");
  recordedChunks = [];

  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    setStatus("Requesting microphone permission (raw audio)...");
    if (!audioStream) {
      const constraints = {
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false
      };
      console.log("Requesting media devices with constraints:", constraints);
      audioStream = await navigator.mediaDevices.getUserMedia(constraints);

      const audioTracks = audioStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const settings = audioTracks[0].getSettings();
        console.log("Actual audio track settings:", settings);
        if (settings.echoCancellation === false) console.log("Echo cancellation successfully disabled.");
        if (settings.noiseSuppression === false) console.log("Noise suppression successfully disabled.");
        if (settings.autoGainControl === false) console.log("Auto gain control successfully disabled.");
      }
    }

    mediaRecorder = new MediaRecorder(audioStream);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      setStatus("Processing recorded audio...");
      const audioBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      recordedChunks = [];

      try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        setStatus("Plotting data...");
        if (!chartInstance) initializeChart();
        plotData(audioBuffer); // Call the updated plotData
        setStatus("Process complete. Ready for next run.");
        isProcessing = false;
        startButton.disabled = false;

      } catch (error) {
        console.error("Error decoding or processing Blob:", error);
        setStatus(`Error processing audio: ${error.message}. Please try again.`);
        isProcessing = false;
        startButton.disabled = false;
      }
    };

    mediaRecorder.onerror = (event) => {
      console.error("MediaRecorder error:", event.error);
      setStatus(`Recording error: ${event.error.name}. Please try again.`);
      if (window.currentOscillator) { try { window.currentOscillator.stop(); } catch (e) { } }
      isProcessing = false;
      startButton.disabled = false;
    };

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
    oscillator.frequency.setValueAtTime(START_FREQ_HZ, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(END_FREQ_HZ, audioCtx.currentTime + CHIRP_DURATION_S);
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    window.currentOscillator = oscillator;

    const startTime = audioCtx.currentTime;
    oscillator.start(startTime);
    mediaRecorder.start();
    setStatus(`Playing ${CHIRP_DURATION_S}s chirp & recording...`);

    oscillator.stop(startTime + CHIRP_DURATION_S);
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        console.log("MediaRecorder stopped.");
      }
      if (window.currentOscillator) delete window.currentOscillator;
    }, CHIRP_DURATION_S * 1000 + 150);

  } catch (err) {
    console.error("Error during setup or playback:", err);
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') setStatus("Microphone access denied.");
    else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') setStatus("No microphone found.");
    else if (err.name === 'OverconstrainedError') {
      setStatus(`Audio constraints not supported: ${err.message}. Trying fallback...`);
      audioStream = null; // Reset stream to retry without constraints
      startProcess(); // Retry
      return;
    } else setStatus(`An error occurred: ${err.message}`);
    isProcessing = false;
    startButton.disabled = false;
  }
}

// --- Plotting Function (MODIFIED) ---
function plotData(audioBuffer) {
  const pcmData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = pcmData.length;
  const plotDataMax = []; // Array for max points
  const plotDataRms = []; // Array for RMS points

  // Get the current pixel width of the canvas for dynamic binning
  const canvasWidth = canvas.clientWidth || 600; // Use clientWidth, fallback if needed
  // Prevent division by zero or excessively small width
  const effectiveCanvasWidth = Math.max(1, canvasWidth);

  // Calculate how many samples correspond to one pixel horizontally
  const samplesPerPixel = Math.max(1, Math.floor(numSamples / effectiveCanvasWidth));

  console.log(`Processing ${numSamples} samples, Sample Rate: ${sampleRate} Hz`);
  console.log(`Canvas Width: ${canvasWidth}px, Samples per Pixel Bin: ${samplesPerPixel}`);

  // Iterate through the data in chunks based on samplesPerPixel
  for (let i = 0; i < numSamples; i += samplesPerPixel) {
    const chunkEnd = Math.min(i + samplesPerPixel, numSamples); // Ensure not exceeding bounds
    let maxAbsValue = 0;
    let sumOfSquares = 0;
    let actualSamplesInChunk = 0; // Count samples actually processed in this chunk

    // Process the chunk
    for (let j = i; j < chunkEnd; j++) {
      const sampleValue = pcmData[j];
      const absSampleValue = Math.abs(sampleValue);

      // Find max absolute value in the chunk
      if (absSampleValue > maxAbsValue) {
        maxAbsValue = absSampleValue;
      }
      // Accumulate sum of squares for RMS
      sumOfSquares += sampleValue * sampleValue;
      actualSamplesInChunk++;
    }

    if (actualSamplesInChunk === 0) continue; // Skip empty chunks if any

    // Calculate RMS for the chunk
    const rmsValue = Math.sqrt(sumOfSquares / actualSamplesInChunk);

    // Determine the time and frequency for this chunk
    // Use the middle sample index of the chunk for time calculation
    const middleSampleIndex = i + Math.floor(actualSamplesInChunk / 2);
    const time = middleSampleIndex / sampleRate;
    const clampedTime = Math.min(time, CHIRP_DURATION_S); // Clamp time to chirp duration
    const frequency = timeToFrequency(clampedTime, CHIRP_DURATION_S, START_FREQ_HZ, END_FREQ_HZ);

    // Convert max and RMS to dB
    const maxDb = amplitudeToDb(maxAbsValue);
    const rmsDb = amplitudeToDb(rmsValue);

    // Add points to respective datasets
    if (frequency >= START_FREQ_HZ && frequency <= END_FREQ_HZ) {
      plotDataMax.push({ x: frequency, y: maxDb });
      plotDataRms.push({ x: frequency, y: rmsDb });
    }
  }

  console.log(`Generated ${plotDataMax.length} Max points and ${plotDataRms.length} RMS points.`);

  if (chartInstance) {
    // Update both datasets
    chartInstance.data.datasets[0].data = plotDataMax; // Max values
    chartInstance.data.datasets[1].data = plotDataRms; // RMS values
    chartInstance.update('none'); // Update without animation
  } else {
    console.error("Chart instance not found for plotting.");
    setStatus("Error: Chart not initialized.");
  }
}

// --- Event Listener ---
startButton.addEventListener('click', startProcess);

// --- Initial Setup ---
initializeChart();
setStatus("Ready. Click button to start.");

// --- Cleanup on page unload ---
window.addEventListener('beforeunload', () => {
  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop());
    console.log("Audio stream stopped on page unload.");
  }
  if (audioCtx && audioCtx.state !== 'closed') {
    audioCtx.close();
    console.log("AudioContext closed on page unload.");
  }
});