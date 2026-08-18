package com.dengageecomm.demo

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import coil.load
import com.dengage.sdk.domain.inboxmessage.model.InboxMessage
import com.dengageecomm.demo.databinding.ActivityInboxBinding
import com.dengageecomm.demo.databinding.ItemInboxBinding

/* ============================================================================
   The messages Dengage holds for this device.

   The mobile twin of the storefront's inbox drawer, holding to its two rules:

   The empty states tell the truth. Before the SDK answers, the screen says it
   is checking, never that there is nothing, because "no messages" while the
   list is still loading is the kind of small lie that surfaces mid-call. An
   error names itself, and only a genuinely empty answer says empty.

   Dismissing is local to this phone. The account is shared, and a message
   removed from Dengage's copy is removed from the demo, so the swipe that
   feels like tidying up must never reach the server. Opening a message does
   report the click, because a read receipt is what the panel's report needs
   and it destroys nothing.
   ========================================================================== */
class InboxActivity : AppCompatActivity() {

    private lateinit var binding: ActivityInboxBinding
    private val hiddenPrefs by lazy { getSharedPreferences("rh_demo_inbox", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityInboxBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        binding.inboxList.layoutManager = LinearLayoutManager(this)
        refresh()
        binding.inboxRefresh.setOnClickListener { refresh() }
    }

    override fun onSupportNavigateUp(): Boolean { finish(); return true }

    private fun hiddenIds(): MutableSet<String> =
        (hiddenPrefs.getStringSet("hidden", emptySet()) ?: emptySet()).toMutableSet()

    private fun refresh() {
        binding.inboxState.visibility = View.VISIBLE
        binding.inboxState.text = getString(R.string.inbox_checking)
        binding.inboxList.visibility = View.GONE

        DengageGateway.inboxMessages(
            limit = 50,
            offset = 0,
            onResult = { messages ->
                runOnUiThread {
                    val hidden = hiddenIds()
                    val visible = messages.filter { it.id !in hidden }
                    if (visible.isEmpty()) {
                        binding.inboxState.visibility = View.VISIBLE
                        binding.inboxState.text = getString(R.string.inbox_empty)
                        binding.inboxList.visibility = View.GONE
                    } else {
                        binding.inboxState.visibility = View.GONE
                        binding.inboxList.visibility = View.VISIBLE
                        binding.inboxList.adapter = InboxAdapter(
                            visible,
                            onOpen = { message -> open(message) },
                            onDismiss = { message -> dismiss(message) }
                        )
                    }
                }
            },
            onError = { message ->
                runOnUiThread {
                    binding.inboxState.visibility = View.VISIBLE
                    binding.inboxState.text = getString(R.string.inbox_error, message)
                    binding.inboxList.visibility = View.GONE
                }
            }
        )
    }

    private fun open(message: InboxMessage) {
        DengageGateway.inboxMessageOpened(message.id)
        val target = message.data.androidTargetUrl ?: message.data.targetUrl
        if (!target.isNullOrBlank()) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(target)))
            } catch (err: Exception) {
                /* A target nothing on this phone can open is reported read
                   and stays on screen. */
            }
        }
        refresh()
    }

    /* Local only, by design. See the header. */
    private fun dismiss(message: InboxMessage) {
        hiddenPrefs.edit().putStringSet("hidden", hiddenIds().apply { add(message.id) }).apply()
        refresh()
    }
}

private class InboxAdapter(
    private val messages: List<InboxMessage>,
    private val onOpen: (InboxMessage) -> Unit,
    private val onDismiss: (InboxMessage) -> Unit
) : RecyclerView.Adapter<InboxAdapter.Holder>() {

    class Holder(val binding: ItemInboxBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        Holder(ItemInboxBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun getItemCount() = messages.size

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val message = messages[position]
        val b = holder.binding

        b.inboxTitle.text = message.data.title ?: ""
        b.inboxBody.text = message.data.message ?: ""
        b.inboxDate.text = friendlyDate(message.data.receiveDate)
        b.root.alpha = if (message.isClicked) 0.55f else 1f

        val media = message.data.androidMediaUrl ?: message.data.mediaUrl
        if (media.isNullOrBlank()) {
            b.inboxMedia.visibility = View.GONE
        } else {
            b.inboxMedia.visibility = View.VISIBLE
            b.inboxMedia.load(media) { crossfade(true) }
        }

        b.inboxOpen.setOnClickListener { onOpen(message) }
        b.inboxDismiss.setOnClickListener { onDismiss(message) }
    }

    /* The server sends an ISO style timestamp. Readable beats precise here,
       and an unparseable one is shown as it came rather than hidden. */
    private fun friendlyDate(raw: String?): String {
        if (raw.isNullOrBlank()) return ""
        return raw.replace('T', ' ').take(16)
    }
}
