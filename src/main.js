import { invoke } from '@tauri-apps/api/core';

const datetimeInput = document.getElementById('datetimeInput');
const timezoneSelect = document.getElementById('timezoneSelect');
const convertBtn = document.getElementById('convertBtn');
const timestampResult = document.getElementById('timestampResult');
const errorMsgDiv = document.getElementById('errorMsg');

async function convert() {
    errorMsgDiv.style.display = 'none';
    timestampResult.innerText = '转换中...';

    const datetimeStr = datetimeInput.value.trim();
    const timezone = timezoneSelect.value;

    if (!datetimeStr) {
        showError('请输入时间字符串');
        return;
    }

    try {
        const response = await invoke('convert_to_timestamp', {
            request: {
                datetime_str: datetimeStr,
                timezone: timezone
            }
        });

        if (response.success) {
            timestampResult.innerText = response.timestamp;
        } else {
            showError(response.error);
            timestampResult.innerText = '—';
        }
    } catch (err) {
        showError(`调用失败: ${err}`);
        timestampResult.innerText = '—';
    }
}

function showError(msg) {
    errorMsgDiv.innerText = msg;
    errorMsgDiv.style.display = 'block';
}

convertBtn.addEventListener('click', convert);
datetimeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') convert();
});