# スキャナー外のintelligibility書き起こし課題

2026-11-04。研究室PCのブラウザーで行う、GitHub Pages向けの静的HTML/JavaScriptです。現行のMRI課題とは独立しています。公開先は [Ryuya-dot-com/fMRI_intelligibility](https://github.com/Ryuya-dot-com/fMRI_intelligibility)、利用URLは https://ryuya-dot-com.github.io/fMRI_intelligibility/ です。

## 開く

このリポジトリのルートで次を実行し、Chromeで `http://localhost:8767/` を開きます。

```sh
python3 -m http.server 8767 --bind 127.0.0.1 --directory site
```

ファイルをダブルクリックする `file://` では実行できません。最初の画面には参加者ID・参加者名の欄と「次へ」だけを表示します。説明・音量確認の後に練習4問を開始します。練習終了後の「本番を始める」で36問へ進みます。仮音声を用いた動作確認にはテスト用IDと「動作確認用」等の架空名を使い、実参加者と区別してください。音量確認は短い確認音です。

## 採用した仕様

- 日本語音声をひらがなで書き取る。空欄も提出でき、時間制限なし。入力は音声の `playing` イベントから有効、次へ進めるのは `ended` 後。各音声1回、前の試行へ戻れない。
- 36種類の文を各1回、12話者から各3音声。Japanese・Asian・Romanceは各4話者・12音声。条件名は参加者画面には表示しない。
- 同じ条件の3連続を禁止し、先頭条件を固定しない。参加者番号と刺激版から順序を再現する（001と1は同じ）。話者の連続は禁止していない。文と話者の組合せは現時点では刺激表で固定。参加者間の組合せのカウンターバランスは未採用で、本番刺激選定時に決定する。
- 練習4本と本番36本を開始前に取得しSHA-256を確認。外部CDN・サーバーへの参加者ID・氏名・回答送信・アクセス解析なし。配信元への通常のページ・音声取得通信は発生する。
- キー押下・解放、修飾キー、繰返し、入力・削除、IMEの開始・更新・確定、貼付・切取り・ドロップ、選択範囲、回答欄のフォーカス、ページ表示状態、音声・提出時刻を記録する。回答欄外の文字入力を収集する仕組みではない。
- Enterで次へ進まない。IME変換中は「次へ」を無効にする。漢字・カタカナ・英数字は提出前に修正を求める。入力中の文字列も元のまま保存する。

## 練習セッション

練習は次の固定順の4文で、本番とは別の音声・文IDを使用します。公式Pythonパッケージ `kokoro==0.9.4` の `KPipeline(lang_code='j')` と非量子化Kokoro-82M v1.0（PyTorch float32・CPU）、日本語音声 `jf_alpha` で再生成しています。24 kHz・24 bit PCM WAVで保存し、圧縮・ノイズ除去・音量正規化・無音切除は加えていません。以前の量子化ONNX版はユーザーからノイズの指摘があり、今回の音声へ差し替えました。ノイズの原因を量子化だけと断定したものではありません。画面には文の正答・得点を出さず、本番と同じ再生・入力・次への操作を練習します。開始前の例文表示や再生し直しは行いません。

| 順 | 例文 | 正答の読み | モーラ数 |
| --- | --- | --- | ---: |
| 1 | 明日は友達と公園まで歩きます。 | あしたはともだちとこうえんまであるきます | 20 |
| 2 | 机の上にきれいな花を飾りました。 | つくえのうえにきれいなはなをかざりました | 20 |
| 3 | 駅の近くでおいしいパンを買ってきます。 | えきのちかくでおいしいぱんをかってきます | 20 |
| 4 | 弟は部屋で静かに本を読んでいた。 | おとうとはへやでしずかにほんをよんでいた | 20 |

`site/practice.json` に正答・手作業のモーラ分割・音声ハッシュを登録し、起動時も20モーラを検査します。[生成スクリプト](tools/generate_practice.py) と [読み・合成の記録](tools/practice_audio_provenance.json) にOpen JTalkによる独立した読み解析（4文とも20モーラ）を残しています。音声生成とテキスト・読みのモーラ数確認であり、波形から個々のモーラを手作業で分節した記録ではありません。

練習追加によって本番36音声の割当て・提示順・seedは変わりません。同条件3連続の禁止は本番36試行内へ適用し、練習との境界は含めません。練習の入力・得点もCSVへ残しますが、本番のintelligibility集計には含めません。

## 仮音声と本番への差し替え

`site/audio/` の本番枠36本はKokoro v1.0で生成した英語の確認用WAVです。例は “Japanese one. Sentence one.”。12種類の合成音声を話者枠へ割り当てています。Japanese・Asian・Romanceの訛りを合成したものではなく、36の実験文の代わりになる材料でもありません。英語の確認用音声には日本語のモーラ得点を計算せず、`placeholder_not_scored` とします。回答操作の確認時は、任意のひらがなを入力できます。

生成処理は [tools/generate_placeholders.py](tools/generate_placeholders.py)、使用モデルとパッケージの記録は [tools/audio_provenance.json](tools/audio_provenance.json)。既存WAVがある場所へ生成スクリプトを再実行しても上書きしません。モデルは一時環境で生成時だけ使い、ブラウザーへのモデル配布や実験中の音声合成は行いません。

本番刺激が決まったら `site/stimuli.json` の `mode` を `study` にし、`version` を更新します。36件すべてのWAV、SHA-256、文ID・話者ID・条件、`reference_kana` を登録してください。正答は実際に採点対象とする発話を確認して定め、録音の言い間違い等を台本から黙って補正しません。各文は重複不可。音声URLは `audio/ファイル名.wav` とし、同じ公開フォルダへ置きます。検査は未登録の正答、重複文、話者・条件の本数不一致、音声不一致を検出すると開始を止めます。

## モーラ採点の規則

`correct_mora_count / reference_mora_count` を試行ごとに計算します。分母は正答の全モーラ数で、聞き取って入力した範囲の長さではありません。空欄で提出した回答は0。未提示・中断・仮音声は0点にせず得点を空欄にします。

1. UnicodeをNFCに正規化し、空白と指定の句読点を除去する。元の回答は別に保存する。
2. 小さい「ゃゅょぁぃぅぇぉゎ」は直前のかなと合わせて1モーラ。「っ」「ん」「ー」は各1モーラ。「きょう」は「きょ・う」、「がっこう」は「が・っ・こ・う」。不正な先頭の小書きかな等は人手確認扱い。
3. モーラ列をLevenshtein法で照合する。置換・脱落・挿入のコストは各1。最小コストの照合のうち一致数最大を採用し、照合列と各誤り数を保存する。最適照合間で一致数が変わる場合は `review_alignment` とし、得点は暫定値。
4. 一致数を分子にするので、追加のモーラは一致した正答モーラから減点しない。例えば正答「ねこ」に回答「ねこだ」は2/2、挿入1。これは `1 − 編集距離 / モーラ数` とは異なる。余分な入力は `insertions` と照合列で確認する。
5. かなの単純置換によって、長音・助詞・同音異表記を一律に同一視しない。例えば「こうこう」と「こーこー」は未登録なら別の表記。許容する表記は文ごとの `accepted_variants_kana`（配列）に事前登録する。各候補は正答と同じモーラ数に限り、最も一致数が多い候補を使い、採用候補を `scored_reference_kana` に保存する。

この採点は明示した照合規則による実装で、言語学的な正誤をすべて自動判断するものではありません。本番刺激の正答・許容表記と、本番回答に対する妥当性はまだ検証していません。最小編集照合で対応が不自然になる回答や、小書きかな・長音の表記判断は研究者が確認し、生データを上書きせず訂正結果を別ファイルへ記録してください。

## CSVと保存

終了または中断時に**1個のCSV**を自動ダウンロードします。ブラウザーが自動保存を止めた場合は終了画面の「記録を保存する」を押します。ダウンロード開始を、ディスクへの保存完了として判定する機能はありません。実験者は参加者の交代前にファイルの存在を確認してください。

CSVはUTF-8 BOM・CRLF・引用符付きで、Excel等で読めます。`row_type` で次を分けます。本番の試行ごとの解析には **`row_type=trial` かつ `phase=main`** を使用し、`trial_status=completed` と再生完了も確認します。`phase=practice` は練習です。`trial_number` は各phase内の番号、`session_trial_number` は練習を含めた通し番号です。

| row_type | 内容 |
| --- | --- |
| `session` | 参加者ID・氏名、固有session ID、実装・本番・練習刺激版、それぞれのハッシュ、開始日時、ブラウザー、刺激表全体 |
| `schedule` | 練習4試行＋本番36試行の予定、文・話者・条件、WAVハッシュ、正答。未提示も含む |
| `trial` | 実際に開いた試行だけ。回答、再生開始・終了、提出、状態、得点・照合列 |
| `event` | 1操作・イベントにつき1行。連番、時刻、キー、IME、文字列、選択範囲等 |

### 時刻と音響分析への対応

各キーストローク・IME・編集イベントと音声開始・終了に、次を記録します。ms値は整数や小数をそのままCSVへ出力し、秒への丸めは行いません。

| 列 | 意味 |
| --- | --- |
| `event_system_epoch_ms` | コールバック処理時に取得した `Date.now()`。Unix epochからのシステム時刻、整数ms |
| `event_system_utc` | 同じシステム時刻を `YYYY-MM-DDTHH:mm:ss.sssZ` で表現（UTC） |
| `event_perf_ms` | 同時に取得した `performance.now()`。ページ内での高分解能の経過時間 |
| `event_monotonic_epoch_ms` | `performance.timeOrigin + event_perf_ms`。ページ起動を原点とする時計をepoch表現に換算 |
| `system_minus_monotonic_ms` | システム時計と上記換算時計の差。時刻補正・時計のずれの点検用 |
| `browser_event_timestamp_ms` | ブラウザーがイベントに付けた元の `Event.timeStamp`。コールバックの呼出時刻とは別に保存 |
| `browser_event_monotonic_epoch_ms` | 有効な元イベント時刻に `performance.timeOrigin` を加えた値 |
| `browser_event_to_callback_ms` | 元イベント時刻からログ取得までの遅延。キュー待ちの点検用 |
| `browser_event_system_epoch_ms_estimate` | システム時計から上記遅延を引いた推定イベント時刻。遅延中に時計補正がある場合は使わない |
| `relative_to_audio_ms` | ログ取得時刻から最初の `playing` コールバックの検出時刻を引いた値 |
| `browser_event_relative_to_audio_ms` | 元イベント時刻から上記音声開始検出時刻を引いた値 |
| `audio_position_s` / `audio_position_ms` | ログ取得時の `HTMLMediaElement.currentTime`。WAV内の再生位置で、再生終了後は終端で止まる |
| `audio_paused` / `audio_ended` / `audio_playback_rate` | そのイベント時の再生状態・速度 |

試行行には `play_requested_*`・`audio_started_*`・`audio_ended_*`・`first_input_*`・`last_input_*`・`submitted_*`・`interrupted_*` を保存します。各 `*` は `perf_ms`・`system_epoch_ms`・`system_utc`・`monotonic_epoch_ms`。発生していない時点は空欄です。音声開始／終了イベント行と試行行には同じ時計サンプルを使います。開始時の元イベント時刻と `audio_position_at_start_callback_s`、WAVのファイル名・SHA-256・サンプルレート・フレーム数も保存します。セッション行には時刻原点、端末のタイムゾーン、UTCからのオフセットと時刻仕様版を残します。旧CSVにシステム時計がない場合、現在の時計から過去の時刻を補いません。

**ミリ秒単位で保存することと、耳元の音声・物理的なキー押下を1 ms精度で測定することは異なります。** `Date.now()` はPC時計の補正で動き得るため、経過時間は `performance.now()` で計算します。元イベント時刻もブラウザーによる時刻で、OS・入力装置の遅延は含み得ます。`currentTime` の分解能・`playing` 通知の遅延・音声デバイスの出力遅延を実測していません。WAV内の音響特徴との照合には再生位置とハッシュを使えますが、これを耳元のサンプル単位の同期精度として扱いません。別装置の録音と厳密に同期する場合は、同一の出力信号を録音する等の校正で、実施PC・ヘッドホンでの開始遅延と変動、装置間の時計差を確認する必要があります。

時計仕様の参照：[Event.timeStamp](https://developer.mozilla.org/en-US/docs/Web/API/Event/timeStamp)、[performance.timeOrigin](https://developer.mozilla.org/en-US/docs/Web/API/Performance/timeOrigin)、[HTMLMediaElement.currentTime](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime)。


`participant_name_json`・`key_json`・`input_data_json`・`value_json`・`response_json` はJSON文字列です。CSV数式として実行され得る先頭文字は通常列にアポストロフィを付け、元の文字列はJSON列に保持します。解析時にこれらをJSONデコードすれば入力内容を復元できます。

記録はIndexedDBへイベント単位で保存します。再読込後は前回記録の保存画面になり、音声の再提示を伴う自動再開はしません。前回のCSVを保存後に次の参加者へ進みます。過去の全セッションは同じ配信元の [records.html](site/records.html) で再ダウンロードできます。記録は端末・ブラウザー・配信元ごとに独立し、ブラウザーデータの削除やプライベートモード終了で失われ得ます。クラッシュ直前に未完了だった書込みまで保証するものではありません。CSVを一次保存物として回収してください。

保存失敗時は課題を止め、メモリー内の記録をCSVに出します。複数タブで同時に課題を開始することはWeb Locksで防ぎます。研究室PCでは通常モードの最新版Chromeを使い、同じ課題は1タブで実施してください。

## GitHub Pagesへの配置

指定リポジトリには `site/`・`tests/`・`tools/` とREADME・GitHub Actions設定を配置します。`.github/workflows/pages.yml` が `main` へのpush後にテストし、**`site/` の中身だけ**をPagesへ配信します。PagesのsourceはGitHub Actionsです。MRIフォルダ・実データ・CSVをアップロードする処理はありません。

`github-pages.zip` はサイト部分だけをまとめたローカル配布用です。公開URLでの確認と、実施用PCでの機器・日本語IMEの確認は区別します。

相対URLを使用するため、`https://ユーザー.github.io/リポジトリ名/` 配下で動きます。サーバー側の保存機能はなく、CSVはその研究室PCに保存されます。GitHub Pagesに配置した音声・正答はURLへアクセスできる人が取得可能です。表示上隠すことと、アクセス制限は別です。本番音声の公開範囲は素材の扱いに合わせて決定してください。

## 参考文献と教示

Kang, O., Thomson, R. I., & Moran, M. (2018). *Empirical approaches to measuring the intelligibility of different varieties of English in predicting listener comprehension*. Language Learning, 68(1), 115–146. https://doi.org/10.1111/lang.12270 （Zotero item: N7774GWE）。

本文pp.124・127の全文書き起こし課題を参照し、「聞いた内容をそのまま入力する」という教示に反映しました。原研究の採点単位は単語で、本課題の日本語モーラ照合・同時入力・キーストローク記録の根拠として引用するものではありません。原研究のnonsense-sentence課題に対する綴り誤り・同音語の許容規則を、全文書き起こし一般の規則として転用していません。

## 検証

```sh
node --test tests/*.test.mjs
```

ローカルの実施検証と範囲は `verification.json`、公開環境でのテスト・配信結果はGitHub Actionsに記録します。仮音声での動作確認と、本番刺激・実施用PCでの確認を区別します。

参加者名は必須（前後空白を除去、100文字以内）で、端末のIndexedDBとCSVに保存します。ファイル名や音声取得URLへ氏名を含めません。旧記録の氏名は空欄のままとし、現在の入力から補いません。研究室PCではCSV回収後もブラウザー内に氏名を含む記録が残るため、施設の研究データ管理手順に従って扱ってください。

## 練習音声の再生成

[公式モデル](https://huggingface.co/hexgrad/Kokoro-82M) の `config.json`・`kokoro-v1_0.pth`・`voices/jf_alpha.pt` を、同じモデル用フォルダにファイル名を保って置きます（`jf_alpha.pt` もその直下）。音声生成用の独立したPython環境へ `tools/requirements.txt` をインストールし、次のように実行します。スクリプトは公式v1.0モデルのSHA-256を確認し、既存の出力フォルダへ上書きしません。

```sh
python tools/generate_practice.py --model-dir /path/to/kokoro82m --output /path/to/new-practice
```

出力の `audio/`・`practice.json` と検査記録を確認してから、サイトの対応ファイルを差し替えます。生成元は現行 `site/practice.json` の4文です。確認済み事項は有限サンプル・クリッピングなし・読み20モーラ・ハッシュの一致で、聴感上の無雑音や意図した発音すべての保証とは区別します。
