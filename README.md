# スキャナー外のintelligibility書き起こし課題

2026-11-04。研究室PCのブラウザーで行う、GitHub Pages向けの静的HTML/JavaScriptです。現行のMRI課題とは独立しています。公開先は [Ryuya-dot-com/fMRI_intelligibility](https://github.com/Ryuya-dot-com/fMRI_intelligibility)、利用URLは https://ryuya-dot-com.github.io/fMRI_intelligibility/ です。

## 開く

このプロジェクトのルートで次を実行し、Chromeで `http://localhost:8767/` を開きます。

```sh
python3 -m http.server 8767 --bind 127.0.0.1 --directory site
```

ファイルをダブルクリックする `file://` では実行できません。最初の画面には参加者ID・参加者名の欄と「次へ」だけを表示します。説明・音量確認の後に練習4問を開始します。練習終了後の「本番を始める」で36問へ進みます。仮音声を用いた動作確認にはテスト用IDと「動作確認用」等の架空名を使い、実参加者と区別してください。音量確認は短い確認音です。

## 採用した仕様

- 日本語音声を書き取る。ひらがな・カタカナ・漢字を許容し、回答原文と採点用の読みを分ける。空欄も提出でき、時間制限なし。入力は音声の `playing` イベントから有効、次へ進めるのは `ended` 後。各音声1回、前の試行へ戻れない。
- 36種類の文を各1回、12話者から各3音声。Japanese・Asian・Romanceは各4話者・12音声。条件名は参加者画面には表示しない。
- 同じ条件の3連続を禁止し、先頭条件を固定しない。参加者番号と刺激版から順序を再現する（001と1は同じ）。話者の連続は禁止していない。文と話者の組合せは現時点では刺激表で固定。参加者間の組合せのカウンターバランスは未採用で、本番刺激選定時に決定する。
- 練習4本と本番36本を開始前に取得しSHA-256を確認。外部CDN・サーバーへの参加者ID・氏名・回答送信・アクセス解析なし。配信元への通常のページ・音声取得通信は発生する。
- キー押下・解放、修飾キー、繰返し、入力・削除、IMEの開始・更新・確定、貼付・切取り・ドロップ、選択範囲、回答欄のフォーカス、ページ表示状態、音声・提出時刻を記録する。回答欄外の文字入力を収集する仕組みではない。
- Enterで次へ進まない。IME変換中は「次へ」を無効にする。漢字・カタカナ・英数字を含む回答も提出できる。2000文字を上限とし、制御文字は拒否する。漢字等の読みが未確定なら採点を保留し、0点にはしない。入力中の文字列は元のまま保持する。参加者ID・氏名欄のキーストロークは収集しない。

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

`site/audio/` の本番枠36本はKokoro v1.0で生成した英語の確認用WAVです。例は “Japanese one. Sentence one.”。12種類の合成音声を話者枠へ割り当てています。Japanese・Asian・Romanceの訛りを合成したものではなく、36の実験文の代わりになる材料でもありません。英語の確認用音声には日本語のモーラ得点を計算せず、`placeholder_not_scored` とします。回答操作の確認時は、任意の書き起こしを入力できます。

生成処理は [tools/generate_placeholders.py](tools/generate_placeholders.py)、使用モデルとパッケージの記録は [tools/audio_provenance.json](tools/audio_provenance.json)。既存WAVがある場所へ生成スクリプトを再実行しても上書きしません。モデルは一時環境で生成時だけ使い、ブラウザーへのモデル配布や実験中の音声合成は行いません。

本番刺激が決まったら `site/stimuli.json` の `mode` を `study` にし、`version` を更新します。36件すべてのWAV、SHA-256、文ID・話者ID・条件、`reference_kana` を登録してください。正答は実際に採点対象とする発話を確認して定め、録音の言い間違い等を台本から黙って補正しません。各文は重複不可。音声URLは `audio/ファイル名.wav` とし、同じ公開フォルダへ置きます。検査は未登録の正答、重複文、話者・条件の本数不一致、音声不一致を検出すると開始を止めます。

## モーラ採点の規則

`correct_mora_count / reference_mora_count` を試行ごとに計算します。分母は正答の全モーラ数で、聞き取って入力した範囲の長さではありません。空欄で提出した回答は0。未提示・中断・仮音声・読み未確定は0点にせず得点を空欄にします。

1. 元の回答は閲覧用の `response` と厳密な復元用の `response_json` に保存する。採点用の読みではUnicodeをNFCに正規化し、半角かなを全角、通常のカタカナをひらがなへ変換して空白と指定の句読点を除去する。漢字・数字・英字等は推測変換せず `pending_reading` とする。`response_reading`・`reading_status`・`reading_method`・`reading_version` を別に保存する。
2. 小さい「ゃゅょぁぃぅぇぉゎ」は直前のかなと合わせて1モーラ。「っ」「ん」「ー」は各1モーラ。「きょう」は「きょ・う」、「がっこう」は「が・っ・こ・う」。不正な先頭の小書きかな等は人手確認扱い。
3. モーラ列をLevenshtein法で照合する。置換・脱落・挿入のコストは各1。最小コストの照合のうち一致数最大を採用し、照合列と各誤り数を保存する。最適照合間で一致数が変わる場合は `review_alignment` とし、得点は暫定値。
4. 一致数を分子にするので、追加のモーラは一致した正答モーラから減点しない。例えば正答「ねこ」に回答「ねこだ」は2/2、挿入1。これは `1 − 編集距離 / モーラ数` とは異なる。余分な入力は `insertions` と照合列で確認する。
5. かなの単純置換によって、長音・助詞・同音異表記を一律に同一視しない。例えば「こうこう」と「こーこー」は未登録なら別の表記。許容する表記は文ごとの `accepted_variants_kana`（配列）に事前登録する。各候補は正答と同じモーラ数に限り、最も一致数が多い候補を使い、採用候補を `scored_reference_kana` に保存する。

この採点は明示した照合規則による実装で、言語学的な正誤をすべて自動判断するものではありません。本番刺激の正答・許容表記と、本番回答に対する妥当性はまだ検証していません。最小編集照合で対応が不自然になる回答や、小書きかな・長音の表記判断は研究者が確認し、生データを上書きせず訂正結果を別ファイルへ記録してください。

## ZIP・CSVと保存

終了または中断時に**1個のZIP**を自動ダウンロードします。保存名は `intelligibility_参加者ID_sessionID.zip`。保存が始まらない場合は終了画面の「記録を保存する」を押します。ダウンロード開始をディスクへの保存完了とは判定できないため、実験者は参加者の交代前にファイルを確認してください。

| ZIP内のファイル | 内容 |
| --- | --- |
| `session.json` | 参加者ID・氏名、session ID、実装・刺激・時計・記録形式の版、ハッシュ、刺激表、セッション状態。氏名はここだけ |
| `schedule.csv` | 練習4試行＋本番36試行の予定。未提示も含む |
| `trials.csv` | 実際に開いた試行だけを1試行1行で保存。回答原文・読み・採点状態、時刻、入力過程の集計値 |
| `events.csv` | 全イベントを1件1行で保存。時刻、キー、IME、文字列参照、選択範囲など |

CSVはUTF-8 BOM・CRLF・引用符付き。`trials.csv` の `response` 列で最終回答をそのまま読めます。Excelの数式扱いを防ぐため、一部の先頭記号には閲覧用列でアポストロフィを付けます。厳密な入力原文は `response_json` をJSONデコードして復元します。漢字・カタカナ・半角かなもUTF-8で保持します。種類ごとに列を分け、氏名・刺激版・ハッシュ等の共通情報をイベント行へ反復しません。結合キーは `session_id` と `session_trial_number`、イベントの順序は `seq`。`phase=practice` と `phase=main` を区別し、`trial_number` は各phase内の番号、`session_trial_number` は練習を含む通し番号です。提示前の全予定はscheduleに残し、未提示を実施済みのtrial行にしません。

`log_version=value-reference-v1` では、文字列を観測したイベントに `value_seq` を付けます。文字列が変化した時だけ `value_json` を保存し、同じ文字列のイベントは保存元のseqを参照します。空文字列はJSONの `""`、CSVの空セルは「この行には全文を重複保存していない」です。参照は同じセッション・試行内でのみ有効です。文字列差分による推測復元ではなく、全文の重複除去です。キー押下・解放、IME更新、時刻は間引きません。既存の全行全文方式も読込可能です。

IndexedDBはv2に更新し、セッション情報・各試行・各イベントを分離します。キー操作のたびに過去の全試行や刺激表を再保存せず、現在の試行と新イベントを同じトランザクションで保存します。イベントを時間間隔でまとめるバッファーは設けません。再保存時はセッション・試行・イベントを同じ読込トランザクションで取得し、別の時点の状態を混ぜません。ZIP圧縮は回答の終了・保存操作時だけ行います。圧縮ライブラリfflate 0.8.2はサイトに同梱し、実験中のCDN通信はありません。

旧IndexedDBのセッションは削除せず読み込みます。旧記録の再保存もZIP形式ですが、回答・当時の採点・取得済み時刻は変更しません。旧混在CSVは原記録として保持し、旧CSVだけしかない場合のZIP変換はこの分析コマンドの対象外です。

### 分析と読みの確認

Node.js 22以降で、プロジェクトのルートから次を実行します。npm installは不要です。分析処理も端末内で完結します。

```sh
node tools/analyze.mjs /path/to/record1.zip /path/to/record2.zip --out results/initial
```

`--out` の親ディレクトリーは事前に用意し、出力先には未作成のディレクトリーを指定してください。既存結果を上書きしません。ZIPを参加者ごとに読み、詳細イベントの照合後は試行表だけを保持します。出力は次の2個です。

- `analysis_trials.csv`：練習・中断・未採点も含む全観測試行。氏名なし。収集時の採点状態は `recorded_score_status` に保持。
- `readings_review.csv`：読みの確認が必要な完了回答。`response_json` を変更せず、`reviewed_reading` にかなの読み、`reviewer` に確認者、必要なら `note` に判断理由を入力。

```sh
node tools/analyze.mjs /path/to/record1.zip /path/to/record2.zip --readings results/initial/readings_review.csv --out results/reviewed
```

読みを記入した行だけを採用します。session ID・通し試行番号・回答原文の一致を検査し、重複・別回答への適用・確認者なし・中断や仮音声の採点を拒否します。人手確認後は `reading_status=human_confirmed`。元ZIPは変更しません。回答の読みを正答に近づけて補うことはせず、曖昧なものは空欄のまま保留します。IMEログは補助情報であり、参加者が意図した読みの完全な記録ではありません。

本番の分析対象候補は `phase=main`・`trial_status=completed`・`audio_completed=true` を確認します。`analysis_eligible_main` はさらに `score_status=automatic` を満たす採点済み行の目印で、参加者・試行の除外規則ではありません。未確定の読みと `review_alignment` を0点化・黙って除外せず、件数と内容を確認してから採用対象を決めてください。許容表記・長音・助詞は上の採点規則を適用します。

`trials.csv` にも、イベントから計算した次の指標を保存します（`metrics_version=input-process-v1`）。

| 列 | 定義 |
| --- | --- |
| `event_count` | 試行に結び付く全イベント数 |
| `keydown_nonrepeat_nonmodifier_count` | 自動リピート、Shift/Control/Alt/Meta/CapsLockを除くkeydown数。変換・移動・削除キーは含む |
| `input_event_count` | IME変換途中も含むinput数 |
| `composition_count` | compositionstart数 |
| `noncomposition_delete_event_count` | isComposingがfalseのinputのうちinputTypeがdeleteで始まる件数。意味上の誤り修正数ではない |
| `first_keydown_callback_latency_ms` | 上記keydownの最初の処理時刻 − 音声開始処理時刻 |
| `first_input_callback_latency_ms` | 最初のinput処理時刻 − 音声開始処理時刻 |
| `first_commit_callback_latency_ms` | 空でないcompositionend、または非変換中の挿入inputの最初の処理時刻 − 音声開始処理時刻。観測された確定入力の指標 |
| `post_audio_submit_ms` | 提出処理時刻 − 音声終了処理時刻 |
| `visibility_hidden_count` | 試行中の非表示化イベント数 |

時刻差は高分解能時計の処理時刻同士で計算し、該当イベントなしは空欄です。`first_input` は変換途中を含みます。確定入力の指標はブラウザーが通知した内容に基づき、物理的な確定キー時刻ではありません。漢字・かなの文字数をそのまま入力速度の共通分母にせず、入力・変換負荷と聞き取りの難しさを区別してください。音声再生中と終了後の詳細分析にはeventsの再生状態・時刻を使います。

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

試行行には `play_requested_*`・`audio_started_*`・`audio_ended_*`・`first_input_*`・`last_input_*`・`submitted_*`・`interrupted_*` を保存します。各 `*` は `perf_ms`・`system_epoch_ms`・`system_utc`・`monotonic_epoch_ms`。発生していない時点は空欄です。音声開始／終了イベント行と試行行には同じ時計サンプルを使います。開始時の元イベント時刻と `audio_position_at_start_callback_s`、WAVのファイル名・SHA-256・サンプルレート・フレーム数も保存します。session.jsonには時刻原点、端末のタイムゾーン、UTCからのオフセットと時刻仕様版を残します。旧CSVにシステム時計がない場合、現在の時計から過去の時刻を補いません。

**ミリ秒単位で保存することと、耳元の音声・物理的なキー押下を1 ms精度で測定することは異なります。** `Date.now()` はPC時計の補正で動き得るため、経過時間は `performance.now()` で計算します。元イベント時刻もブラウザーによる時刻で、OS・入力装置の遅延は含み得ます。`currentTime` の分解能・`playing` 通知の遅延・音声デバイスの出力遅延を実測していません。WAV内の音響特徴との照合には再生位置とハッシュを使えますが、これを耳元のサンプル単位の同期精度として扱いません。別装置の録音と厳密に同期する場合は、同一の出力信号を録音する等の校正で、実施PC・ヘッドホンでの開始遅延と変動、装置間の時計差を確認する必要があります。

時計仕様の参照：[Event.timeStamp](https://developer.mozilla.org/en-US/docs/Web/API/Event/timeStamp)、[performance.timeOrigin](https://developer.mozilla.org/en-US/docs/Web/API/Performance/timeOrigin)、[HTMLMediaElement.currentTime](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime)。


`key_json`・`input_data_json`・`value_json`・`response_json` はJSON文字列です。CSV数式として実行され得る先頭文字は通常列にアポストロフィを付け、元の文字列はJSON列に保持します。解析時にこれらをJSONデコードすれば入力内容を復元できます。

記録はIndexedDBへイベント単位で保存します。再読込後は前回記録の保存画面になり、音声の再提示を伴う自動再開はしません。前回のZIPを保存後に次の参加者へ進みます。過去の全セッションは同じ配信元の [records.html](site/records.html) で再ダウンロードできます。記録は端末・ブラウザー・配信元ごとに独立し、ブラウザーデータの削除やプライベートモード終了で失われ得ます。クラッシュ直前に未完了だった書込みまで保証するものではありません。ZIPを一次保存物として回収してください。

保存失敗時は課題を止め、メモリー内の記録をZIPに出します。複数タブで同時に課題を開始することはWeb Locksで防ぎます。研究室PCでは通常モードの最新版Chromeを使い、同じ課題は1タブで実施してください。

## GitHub Pagesへの配置

指定リポジトリには `site/`・`tests/`・`tools/` とREADME・GitHub Actions設定を配置します。`.github/workflows/pages.yml` が `main` へのpush後にテストし、**`site/` の中身だけ**をPagesへ配信します。PagesのsourceはGitHub Actionsです。MRIフォルダ・実データ・CSVをアップロードする処理はありません。

`github-pages.zip` はサイト部分だけをまとめたローカル配布用です。公開URLでの確認と、実施用PCでの機器・日本語IMEの確認は区別します。

相対URLを使用するため、`https://ユーザー.github.io/リポジトリ名/` 配下で動きます。サーバー側の保存機能はなく、ZIPはその研究室PCに保存されます。GitHub Pagesに配置した音声・正答はURLへアクセスできる人が取得可能です。表示上隠すことと、アクセス制限は別です。本番音声の公開範囲は素材の扱いに合わせて決定してください。

## 参考文献と教示

Kang, O., Thomson, R. I., & Moran, M. (2018). *Empirical approaches to measuring the intelligibility of different varieties of English in predicting listener comprehension*. Language Learning, 68(1), 115–146. https://doi.org/10.1111/lang.12270 （Zotero item: N7774GWE）。

本文pp.124・127の全文書き起こし課題を参照し、「聞いた内容をそのまま入力する」という教示に反映しました。原研究の採点単位は単語で、本課題の日本語モーラ照合・同時入力・キーストローク記録の根拠として引用するものではありません。原研究のnonsense-sentence課題に対する綴り誤り・同音語の許容規則を、全文書き起こし一般の規則として転用していません。

## 検証

```sh
node --test tests/*.test.mjs
```

ローカルの実施検証と範囲は `verification.json`、公開環境でのテスト・配信結果はGitHub Actionsに記録します。仮音声での動作確認と、本番刺激・実施用PCでの確認を区別します。

参加者名は必須（前後空白を除去、100文字以内）で、端末のIndexedDBとZIP内のsession.jsonに保存します。ファイル名や音声取得URLへ氏名を含めません。旧記録の氏名は空欄のままとし、現在の入力から補いません。研究室PCではZIP回収後もブラウザー内に氏名を含む記録が残るため、施設の研究データ管理手順に従って扱ってください。

## 練習音声の再生成

[公式モデル](https://huggingface.co/hexgrad/Kokoro-82M) の `config.json`・`kokoro-v1_0.pth`・`voices/jf_alpha.pt` を、同じモデル用フォルダにファイル名を保って置きます（`jf_alpha.pt` もその直下）。音声生成用の独立したPython環境へ `tools/requirements.txt` をインストールし、次のように実行します。スクリプトは公式v1.0モデルのSHA-256を確認し、既存の出力フォルダへ上書きしません。

```sh
python tools/generate_practice.py --model-dir /path/to/kokoro82m --output /path/to/new-practice
```

出力の `audio/`・`practice.json` と検査記録を確認してから、サイトの対応ファイルを差し替えます。生成元は現行 `site/practice.json` の4文です。確認済み事項は有限サンプル・クリッピングなし・読み20モーラ・ハッシュの一致で、聴感上の無雑音や意図した発音すべての保証とは区別します。
