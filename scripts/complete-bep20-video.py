"""Resume the approved, fixed BEP20 video ledger and publish count-only reports."""
import datetime as dt
import json
import os
from pathlib import Path
import time
import subprocess

VIDEO = '/admin/batch?kind=notice&ref=2026-11-24-bep20-video'
TEXT = '/admin/batch?kind=notice&ref=2026-11-24-bep20-text'
OUT = Path('broadcast-report')


def request(path):
    # Match the established ops-probe transport; pass the credential via stdin.
    url = 'https://sobhansamadi.mehdifx21hoseini.workers.dev' + path
    config = 'url = ' + json.dumps(url) + '\nheader = ' + json.dumps('x-admin-key: ' + os.environ['WORKER_ADMIN_KEY']) + '\n'
    attempts = 1 if '/econ-notice-drain' in path else 3
    for attempt in range(attempts):
        try:
            result = subprocess.run(['curl', '--silent', '--show-error', '--fail-with-body',
                                     '--max-time', '150', '--config', '-'],
                                    input=config, text=True, capture_output=True, timeout=160)
            if result.returncode:
                raise RuntimeError('Worker request failed, curl code ' + str(result.returncode))
            return json.loads(result.stdout)
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(5)


def report(video, text=None, *, complete=False, resume_after=None):
    OUT.mkdir(exist_ok=True)
    data = {'complete': complete, 'updated_at_utc': dt.datetime.now(dt.timezone.utc).isoformat(),
            'video': video, 'text': text, 'resume_after_utc': resume_after,
            'post': 'https://t.me/sobhanforex/1848',
            'counts': 'Telegram API accepted deliveries in the fixed main audience; not read receipts.'}
    (OUT / 'report.json').write_text(json.dumps(data, ensure_ascii=False, indent=2))
    lines = ['# گزارش ارسال BEP20', '', 'وضعیت: ' + ('پایان‌یافته' if complete else 'در حال ادامه / انتظار تلگرام'), '',
             '| مرحله | موفق | غیرقابل‌دسترسی | ناموفق | باقی‌مانده |', '|---|---:|---:|---:|---:|']
    for label, stats in [('متن', text), ('ویدیو', video)]:
        if stats:
            lines.append(f"| {label} | {stats['sent']} | {stats['blocked']} | {stats['failed']} | {stats['remaining']} |")
    lines += ['', 'ارقام مربوط به صف اصلی و تأیید API تلگرام هستند، نه خوانده‌شدن پیام.',
              'چهار مورد ناموفق متن، موفق محسوب نشده‌اند. سامانهٔ قبلی علت و شناسهٔ فردی آن‌ها را ذخیره نکرده است.',
              'ویدیو فقط از دفتر ارسال ثابت ۲۰۲۶-۱۱-۲۴ ادامه می‌یابد؛ پیام متن در این اجرا ارسال نمی‌شود.']
    if resume_after:
        lines += ['', 'پایان تقریبی انتظار فعلی (UTC): ' + resume_after]
    (OUT / 'report.md').write_text('\n'.join(lines) + '\n')
    if complete:
        (OUT / 'complete').write_text('yes')
    else:
        (OUT / 'complete').unlink(missing_ok=True)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        Path(summary).write_text((OUT / 'report.md').read_text())


def drive(api=request, *, budget=6000, clock=time.monotonic, sleep=time.sleep):
    deadline = clock() + budget
    shard = 0
    text = api(TEXT)['batch']
    while clock() < deadline - 160:
        video = api(VIDEO)['batch']
        if video['first_snapshot'] is None:
            raise RuntimeError('Fixed video audience missing; refusing to create a different audience')
        done = video['remaining'] == 0 and video['open'] == 0 and video['left'] == 0
        report(video, text, complete=False)
        if done:
            disabled = api('/admin/econ-notice?state=off')
            if disabled['notice']['enabled']:
                raise RuntimeError('Cannot confirm broadcast is disabled')
            report(video, text, complete=True)
            print('COMPLETE', json.dumps(video), flush=True)
            return True
        if not api('/admin/econ-notice')['notice']['enabled']:
            print('Campaign is paused; no message will be sent.', flush=True)
            return False
        print('PROGRESS', json.dumps(video), flush=True)
        try:
            result = api('/admin/econ-notice-drain?force=1&driver=1&shards=6&shard=' + str(shard))
        except Exception as error:
            # A timeout may leave an in-flight reservation. Never reset the ledger.
            print('Request deferred:', type(error).__name__, flush=True)
            sleep(15)
            continue
        if result.get('skipped'):
            print('Campaign not sending:', result['skipped'], flush=True)
            return False
        wait = max(0, int(result.get('retry_after') or 0))
        if wait:
            until = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=wait + 2)
            report(video, text, resume_after=until.isoformat())
            stop = min(clock() + wait + 2, deadline - 160)
            print('Telegram cooldown seconds:', wait, flush=True)
            while clock() < stop:
                sleep(min(45, stop - clock()))
        else:
            shard = (shard + 1) % 6
            sleep(1)
    print('Run budget reached; the next scheduled run continues the same ledger.', flush=True)
    return False


if __name__ == '__main__':
    drive()
